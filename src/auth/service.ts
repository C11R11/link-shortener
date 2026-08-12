import { randomBytes, createHash } from 'node:crypto';
import { eq, and, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { AppConfig } from '../config.js';

// Auth service is dialect-compatible: any Drizzle PostgreSQL driver works
// (postgres-js in production, pglite in tests).
export type AuthDb = PostgresJsDatabase | PgliteDatabase;
import { sessions, users } from '../db/schema.js';
import { hashPassword as hashPasswordCrypto, verifyPassword as verifyPasswordCrypto } from './crypto.js';
import type {
  AuthService,
  CreateSessionResult,
  CreateUserInput,
  GetSessionResult,
  SessionRecord,
  UserRecord,
} from './types.js';
import { AuthError } from './types.js';

// Drizzle's postgres-js infers the table type with the column shape but
// `InferSelectModel` is not strictly needed here; we mirror it manually.
type UserRow = typeof users.$inferSelect;

const MIN_PASSWORD_LENGTH = 8;
const SESSION_TOKEN_BYTES = 32;
const DEFAULT_LOCKOUT_MS = 1_000;
const MAX_LOCKOUT_MS = 30 * 60 * 1_000;

interface AttemptState {
  failures: number;
  lockoutUntil: number; // ms epoch
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSessionRecord(row: typeof sessions.$inferSelect): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // Walk the cause chain because some drivers (notably drizzle-orm/pglite)
  // wrap the raw PG error in a DrizzleQueryError; the SQLSTATE lives on cause.
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i += 1) {
    const e = cur as { code?: string; constraint?: string };
    if (e.code === '23505') return true;
    cur = (e as { cause?: unknown }).cause;
  }
  return false;
}

export interface CreateAuthServiceOptions {
  now?: () => number;
}

export function createAuthService(
  config: AppConfig,
  db: AuthDb,
  options: CreateAuthServiceOptions = {},
): AuthService {
  const now = options.now ?? Date.now;
  const attempts = new Map<string, AttemptState>();

  function throttleKey(email: string, ip: string): string {
    return `${email}:${ip}`;
  }

  function lockoutMsFor(failures: number): number {
    // failures=1 -> 1s, 2 -> 2s, 3 -> 4s, ... capped at 30 min
    const exp = DEFAULT_LOCKOUT_MS * 2 ** Math.max(0, failures - 1);
    return Math.min(exp, MAX_LOCKOUT_MS);
  }

  function recordFailure(key: string): void {
    const existing = attempts.get(key) ?? { failures: 0, lockoutUntil: 0 };
    const nextFailures = existing.failures + 1;
    const lockoutMs = lockoutMsFor(nextFailures);
    attempts.set(key, {
      failures: nextFailures,
      lockoutUntil: now() + lockoutMs,
    });
  }

  function recordSuccess(key: string): void {
    attempts.delete(key);
  }

  async function hashPassword(plain: string): Promise<string> {
    return hashPasswordCrypto(plain);
  }

  async function createUser(input: CreateUserInput): Promise<UserRecord> {
    const email = input.email.trim().toLowerCase();
    const password = input.password ?? '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(400, 'invalid_password', 'Password must be at least 8 characters');
    }
    const passwordHash = await hashPasswordCrypto(password);
    try {
      const [row] = await db
        .insert(users)
        .values({
          email,
          name: input.name ?? null,
          passwordHash,
        })
        .returning();
      return toUserRecord(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AuthError(409, 'email_taken', 'A user with that email already exists');
      }
      throw err;
    }
  }

  async function validateCredentials(email: string, password: string, ip: string): Promise<UserRecord | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const key = throttleKey(normalizedEmail, ip);
    const state = attempts.get(key);
    if (state && state.lockoutUntil > now()) {
      // Still in lockout; do not perform password work.
      return null;
    }
    if (state && state.lockoutUntil <= now()) {
      // Lockout expired; reset so we start fresh.
      attempts.delete(key);
    }

    const rows = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    const row = rows[0];
    if (!row || !row.isActive) {
      recordFailure(key);
      return null;
    }

    const ok = await verifyPasswordCrypto(password, row.passwordHash);
    if (!ok) {
      recordFailure(key);
      return null;
    }

    recordSuccess(key);
    return toUserRecord(row);
  }

  async function createSession(userId: string, ttlSeconds?: number): Promise<CreateSessionResult> {
    const defaultTtl = (config as { SESSION_MAX_AGE_SECONDS?: number }).SESSION_MAX_AGE_SECONDS ?? 604800;
    const ttl = ttlSeconds ?? defaultTtl;
    const rawToken = generateSessionToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(now() + ttl * 1000);
    const [row] = await db
      .insert(sessions)
      .values({ userId, tokenHash, expiresAt })
      .returning();
    return { sessionRecord: toSessionRecord(row), rawToken };
  }

  async function getSessionByToken(rawToken: string): Promise<GetSessionResult | null> {
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    const rows = await db
      .select({
        session: sessions,
        user: users,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    if (row.session.expiresAt.getTime() <= now()) {
      // Lazy delete of expired session.
      await db.delete(sessions).where(eq(sessions.id, row.session.id));
      return null;
    }
    if (!row.user.isActive) {
      return null;
    }

    return { session: toSessionRecord(row.session), user: toUserRecord(row.user) };
  }

  async function revokeSessionByRawToken(rawToken: string): Promise<void> {
    if (!rawToken) return;
    const tokenHash = hashToken(rawToken);
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  async function revokeSessionByHash(tokenHash: string): Promise<void> {
    if (!tokenHash) return;
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  async function revokeAllUserSessions(userId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async function updatePassword(userId: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(400, 'invalid_password', 'Password must be at least 8 characters');
    }
    const passwordHash = await hashPasswordCrypto(newPassword);
    const updatedAt = new Date(now());
    await db
      .update(users)
      .set({ passwordHash, updatedAt })
      .where(eq(users.id, userId));
    await revokeAllUserSessions(userId);
  }

  return {
    hashPassword,
    createUser,
    validateCredentials,
    createSession,
    getSessionByToken,
    revokeSessionByRawToken,
    revokeSessionByHash,
    revokeAllUserSessions,
    updatePassword,
  };
}

export type { AttemptState };
