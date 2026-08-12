import type { FastifyInstance } from 'fastify';
import type {
  AuthService,
  CreateSessionResult,
  CreateUserInput,
  GetSessionResult,
  SessionRecord,
  UserRecord,
} from '../../src/auth/types.js';

export const FAKE_ADMIN = {
  id: 'user-1',
  email: 'admin@example.com',
  password: 'password123',
} as const;

const FAKE_SESSION_TOKEN = 'test-session-token';

const fakeUser: UserRecord = {
  id: FAKE_ADMIN.id,
  email: FAKE_ADMIN.email,
  name: 'Admin',
  passwordHash: 'fake-hash',
  role: 'admin',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const fakeSession: SessionRecord = {
  id: 'session-1',
  userId: FAKE_ADMIN.id,
  tokenHash: 'fake-token-hash',
  expiresAt: new Date('2099-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

export function makeFakeAuth(): AuthService {
  return {
    hashPassword: async () => 'fake-hash',
    createUser: async (_input: CreateUserInput): Promise<UserRecord> => {
      throw new Error('createUser not implemented in fake auth');
    },
    validateCredentials: async (email: string, password: string, _ip: string) => {
      if (
        typeof email === 'string' &&
        email.toLowerCase() === FAKE_ADMIN.email.toLowerCase() &&
        password === FAKE_ADMIN.password
      ) {
        return fakeUser;
      }
      return null;
    },
    createSession: async (userId: string): Promise<CreateSessionResult> => {
      return {
        rawToken: FAKE_SESSION_TOKEN,
        sessionRecord: { ...fakeSession, userId },
      };
    },
    getSessionByToken: async (rawToken: string): Promise<GetSessionResult | null> => {
      if (rawToken === FAKE_SESSION_TOKEN) {
        return { session: fakeSession, user: fakeUser };
      }
      return null;
    },
    revokeSessionByRawToken: async () => {},
    revokeSessionByHash: async () => {},
    revokeAllUserSessions: async () => {},
    updatePassword: async () => {},
  };
}

/**
 * Extract just the `name=value` portion of a Set-Cookie header value,
 * stripping attributes like Path, HttpOnly, SameSite, etc.
 */
function cookieNameValue(setCookie: string): string {
  return setCookie.split(';')[0]?.trim() ?? '';
}

/**
 * Extract the first signed CSRF cookie value from a Set-Cookie response
 * header. The helper matches the configured CSRF cookie name on the
 * input app.
 */
function extractCsrfCookie(setCookieHeader: string | string[] | undefined): string | null {
  if (!setCookieHeader) return null;
  const entries = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const entry of entries) {
    const nameValue = cookieNameValue(entry);
    if (!nameValue) continue;
    // Accept any csrf cookie regardless of name; the test will use it
    // for the matching POST request, so the helper does not need to
    // know the configured cookie name.
    if (/csrf/i.test(nameValue.split('=')[0] ?? '')) {
      return nameValue;
    }
  }
  return null;
}

/**
 * Extract the CSRF token from the hidden input rendered by the login page.
 */
function extractCsrfTokenFromHtml(html: string): string | null {
  const match = html.match(/name="csrfToken"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Performs a full login flow against the test app:
 * 1. GET /admin/login to obtain the CSRF token from the page body and
 *    the signed CSRF cookie from the response headers.
 * 2. POST /admin/login with the credentials, CSRF token, and CSRF cookie.
 * 3. Returns the full `set-cookie` header from the POST response so
 *    callers can attach the signed session cookie to subsequent injects.
 */
export async function loginAsAdmin(
  app: FastifyInstance,
  _auth: AuthService = makeFakeAuth(),
): Promise<string> {
  // Step 1: GET the login page to retrieve the CSRF token + cookie.
  const loginPage = await app.inject({ method: 'GET', url: '/admin/login' });
  if (loginPage.statusCode !== 200) {
    throw new Error(
      `loginAsAdmin: GET /admin/login returned ${loginPage.statusCode}; expected 200`,
    );
  }

  const csrfToken = extractCsrfTokenFromHtml(loginPage.body);
  if (!csrfToken) {
    throw new Error('loginAsAdmin: could not find CSRF token in login page body');
  }

  const csrfCookie = extractCsrfCookie(loginPage.headers['set-cookie']);
  if (!csrfCookie) {
    throw new Error('loginAsAdmin: could not find CSRF cookie in GET /admin/login response');
  }

  // Step 2: POST credentials with the CSRF token and cookie.
  const submit = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: csrfCookie,
    },
    payload: `email=${encodeURIComponent(FAKE_ADMIN.email)}&password=${encodeURIComponent(FAKE_ADMIN.password)}&csrfToken=${encodeURIComponent(csrfToken)}`,
  });

  if (submit.statusCode !== 302) {
    throw new Error(
      `loginAsAdmin: POST /admin/login returned ${submit.statusCode}; expected 302. body=${submit.body}`,
    );
  }

  // Step 3: Return a clean Cookie header (just `name=value` pairs
  // separated by `; `) so callers can attach it to subsequent injects.
  const setCookie = submit.headers['set-cookie'];
  if (!setCookie) {
    throw new Error('loginAsAdmin: POST /admin/login did not set any cookies');
  }
  const entries = Array.isArray(setCookie) ? setCookie : [setCookie];
  const pairs = entries
    .map((entry) => cookieNameValue(entry))
    .filter((pair) => pair.length > 0 && !/=$/.test(pair));
  if (pairs.length === 0) {
    throw new Error('loginAsAdmin: POST /admin/login set only empty cookies');
  }
  return pairs.join('; ');
}

/**
 * Returns the headers object required to authenticate subsequent inject
 * calls using a session cookie string returned from `loginAsAdmin`.
 */
export function authHeaders(cookies: string): { cookie: string } {
  return { cookie: cookies };
}
