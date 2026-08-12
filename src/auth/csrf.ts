import type { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';

const CSRF_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function csrfCookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.SHORTENER_SCHEME === 'https',
    sameSite: 'lax' as const,
    path: '/',
    signed: true,
    maxAge: CSRF_MAX_AGE_MS,
  };
}

/**
 * Returns the unsigned CSRF token from the signed cookie, generating and storing
 * a new one if the cookie is missing or invalid. Always re-sets the cookie so
 * the token on the wire is fresh for the next render.
 */
export function getOrCreateCsrfToken(request: FastifyRequest, reply: FastifyReply, config: AppConfig): string {
  const cookieName = config.CSRF_COOKIE_NAME;
  const raw = request.cookies?.[cookieName];
  let token: string | null = null;
  if (raw) {
    const unsigned = request.unsignCookie(raw);
    if (unsigned.valid && unsigned.value) {
      token = unsigned.value;
    }
  }
  if (!token) {
    token = crypto.randomBytes(32).toString('base64url');
  }
  reply.setCookie(cookieName, token, csrfCookieOptions(config));
  return token;
}

/**
 * Validates that the request's signed CSRF cookie and body.csrfToken match.
 * Uses a constant-time comparison when lengths match.
 */
export function validateCsrfToken(request: FastifyRequest, config: AppConfig): boolean {
  const raw = request.cookies?.[config.CSRF_COOKIE_NAME];
  if (!raw) return false;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return false;
  const body = request.body as { csrfToken?: unknown } | null | undefined;
  const bodyToken = typeof body?.csrfToken === 'string' ? body.csrfToken : null;
  if (!bodyToken) return false;
  const a = Buffer.from(unsigned.value);
  const b = Buffer.from(bodyToken);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Sends a 403 response that redirects HTML form posts back to the dashboard
 * with an `error=csrf` query string so the UI can surface the failure.
 */
export function csrfFailureRedirect(reply: FastifyReply): FastifyReply {
  reply.header('Location', '/admin/dashboard?error=csrf');
  return reply.code(403);
}
