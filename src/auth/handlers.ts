import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { AuthService } from './types.js';
import { AuthError } from './types.js';
import { renderLoginPage } from './login.components.js';

const CSRF_TOKEN_BYTES = 32;
const CSRF_MAX_AGE_SECONDS = 60 * 60; // 1 hour
const GENERIC_LOGIN_ERROR = 'Invalid email or password';

function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
}

function sessionCookieOptions(config: AppConfig, ttlSeconds: number) {
  return {
    httpOnly: true,
    secure: config.SHORTENER_SCHEME === 'https',
    sameSite: 'lax' as const,
    path: '/',
    signed: true,
    maxAge: ttlSeconds * 1000,
  };
}

function csrfCookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.SHORTENER_SCHEME === 'https',
    sameSite: 'lax' as const,
    path: '/',
    signed: true,
    maxAge: CSRF_MAX_AGE_SECONDS * 1000,
  };
}

function readCsrfToken(request: FastifyRequest, config: AppConfig): string | null {
  const raw = request.cookies?.[config.CSRF_COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return unsigned.value;
}

function setCsrfToken(reply: FastifyReply, token: string, config: AppConfig): void {
  reply.setCookie(config.CSRF_COOKIE_NAME, token, csrfCookieOptions(config));
}

function clearCsrfToken(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(config.CSRF_COOKIE_NAME, { path: '/' });
}

function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
}

function setSessionCookie(
  reply: FastifyReply,
  config: AppConfig,
  rawToken: string,
  ttlSeconds: number,
): void {
  reply.setCookie(config.SESSION_COOKIE_NAME, rawToken, sessionCookieOptions(config, ttlSeconds));
}

async function readSessionUser(
  request: FastifyRequest,
  config: AppConfig,
  auth: AuthService,
): Promise<{ rawToken: string; userId: string; email: string } | null> {
  const raw = request.cookies?.[config.SESSION_COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const result = await auth.getSessionByToken(unsigned.value);
  if (!result) return null;
  return {
    rawToken: unsigned.value,
    userId: result.user.id,
    email: result.user.email,
  };
}

export function registerAuth(app: FastifyInstance, config: AppConfig, auth: AuthService): void {
  app.get('/admin/login', async (request, reply) => {
    const existing = await readSessionUser(request, config, auth);
    if (existing) {
      return reply.redirect('/admin/dashboard');
    }

    const csrfToken = generateCsrfToken();
    setCsrfToken(reply, csrfToken, config);
    return reply
      .type('text/html')
      .send(renderLoginPage(config, undefined, undefined, csrfToken));
  });

  app.post('/admin/login', async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: string;
      password?: string;
      csrfToken?: string;
    };

    const submittedCsrf = typeof body.csrfToken === 'string' ? body.csrfToken : '';
    const expectedCsrf = readCsrfToken(request, config);
    if (!expectedCsrf || !submittedCsrf || expectedCsrf !== submittedCsrf) {
      // Re-render the login page with a fresh CSRF token so the user
      // can retry without leaving the form.
      const freshCsrf = generateCsrfToken();
      setCsrfToken(reply, freshCsrf, config);
      return reply
        .code(403)
        .type('text/html')
        .send(renderLoginPage(config, 'Invalid CSRF token', body.email, freshCsrf));
    }

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = request.ip ?? 'unknown';

    const user = await auth.validateCredentials(email, password, ip);
    if (!user) {
      // Issue a fresh CSRF token so the user can retry; keep the email
      // they typed in the form.
      const freshCsrf = generateCsrfToken();
      setCsrfToken(reply, freshCsrf, config);
      return reply
        .code(401)
        .type('text/html')
        .send(renderLoginPage(config, GENERIC_LOGIN_ERROR, email, freshCsrf));
    }

    const ttlSeconds = config.SESSION_MAX_AGE_SECONDS;
    const { rawToken } = await auth.createSession(user.id, ttlSeconds);
    setSessionCookie(reply, config, rawToken, ttlSeconds);
    clearCsrfToken(reply, config);
    return reply.redirect('/admin/dashboard');
  });

  app.post('/admin/logout', async (request, reply) => {
    const existing = await readSessionUser(request, config, auth);
    if (existing) {
      await auth.revokeSessionByRawToken(existing.rawToken);
    }
    clearSessionCookie(reply, config);
    return reply.redirect('/admin/login');
  });

  app.post('/admin/change-password', async (request, reply) => {
    const existing = await readSessionUser(request, config, auth);
    if (!existing) {
      return reply.redirect('/admin/login');
    }

    const body = (request.body ?? {}) as {
      csrfToken?: string;
      currentPassword?: string;
      newPassword?: string;
    };

    const submittedCsrf = typeof body.csrfToken === 'string' ? body.csrfToken : '';
    const expectedCsrf = readCsrfToken(request, config);
    if (!expectedCsrf || !submittedCsrf || expectedCsrf !== submittedCsrf) {
      return reply.code(403).type('text/html').send('Forbidden');
    }

    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    const verified = await auth.validateCredentials(existing.email, currentPassword, request.ip ?? 'unknown');
    if (!verified) {
      const freshCsrf = generateCsrfToken();
      setCsrfToken(reply, freshCsrf, config);
      return reply.redirect('/admin/dashboard?error=invalid-current-password');
    }

    try {
      await auth.updatePassword(existing.userId, newPassword);
    } catch (err) {
      if (err instanceof AuthError && err.code === 'invalid_password') {
        return reply.redirect('/admin/dashboard?error=invalid-new-password');
      }
      throw err;
    }

    // updatePassword revoked all sessions (including this one); mint a
    // fresh session so the caller remains logged in.
    const ttlSeconds = config.SESSION_MAX_AGE_SECONDS;
    const { rawToken } = await auth.createSession(existing.userId, ttlSeconds);
    setSessionCookie(reply, config, rawToken, ttlSeconds);
    clearCsrfToken(reply, config);
    return reply.redirect('/admin/dashboard?success=password-changed');
  });

  app.get('/admin/session', async (request, reply) => {
    const existing = await readSessionUser(request, config, auth);
    if (!existing) {
      return reply.code(401).send({ authenticated: false });
    }
    return reply.send({ authenticated: true, email: existing.email });
  });
}
