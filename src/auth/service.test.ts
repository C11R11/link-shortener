import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { hashPassword, verifyPassword } from './crypto.js';
import { createAuthService } from './service.js';
import { AuthError } from './types.js';
import type { AppConfig } from '../config.js';
import * as schema from '../db/schema.js';
import { users, sessions } from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, '..', '..', 'migrations');

function loadMigrationFiles(): string[] {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  return files.map((name) => {
    const sql = readFileSync(join(migrationsDir, name), 'utf8');
    // pglite ships gen_random_uuid() built in; skip the pgcrypto extension
    // line that targets real Postgres so we don't error on the missing extension.
    return sql.replace(/^\s*CREATE\s+EXTENSION[^;]*;\s*$/gim, '');
  });
}

interface TestDb {
  pg: PGlite;
  drizzleDb: ReturnType<typeof drizzle<typeof schema>>;
}

async function makeDb(): Promise<TestDb> {
  const pg = new PGlite();
  const drizzleDb = drizzle(pg, { schema, casing: 'snake_case' });
  for (const sql of loadMigrationFiles()) {
    await pg.exec(sql);
  }
  return { pg, drizzleDb };
}

async function clearDb(pg: PGlite): Promise<void> {
  // RESTART IDENTITY so unique-keyed state from previous tests is gone.
  await pg.exec('TRUNCATE TABLE sessions, users RESTART IDENTITY CASCADE;');
}

const baseConfig: AppConfig = {
  APP_PORT: 3000,
  SHORTENER_DOMAIN: 'test.local',
  SHORTENER_SCHEME: 'http',
  DATABASE_URL: 'postgres://x',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough-32+',
  SESSION_MAX_AGE_SECONDS: 604800,
  SESSION_COOKIE_NAME: 'link_shortener_session',
  CSRF_COOKIE_NAME: 'link_shortener_csrf',
  ADMIN_TOKEN: 'change-me',
  REDIRECT_STATUS_CODE: 302,
};

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...baseConfig, ...overrides } as AppConfig;
}

describe('auth/crypto', () => {
  it('hashes and verifies a password round-trip', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.ok(hash.startsWith('$argon2id$'), 'should be an Argon2id encoded hash');
    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  });

  it('returns false for a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.equal(await verifyPassword('wrong password', hash), false);
  });

  it('returns false for an empty/garbage hash without throwing', async () => {
    assert.equal(await verifyPassword('anything', ''), false);
    assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
  });
});

describe('auth/service', () => {
  let db: TestDb;
  let service: ReturnType<typeof createAuthService>;

  before(async () => {
    db = await makeDb();
  });

  beforeEach(async () => {
    // Reset table state but keep the expensive PGlite instance alive.
    await clearDb(db.pg);
    // Rebuild service so the in-memory throttle map is reset between tests.
    service = createAuthService(
      makeConfig({ SESSION_MAX_AGE_SECONDS: 60 } as Partial<AppConfig>),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.drizzleDb as any,
    );
  });

  it('createUser inserts a user and rejects duplicate emails', async () => {
    const u = await service.createUser({ email: 'Admin@Example.com', password: 'password123' });
    assert.equal(u.email, 'admin@example.com');
    assert.ok(u.id);
    assert.equal(u.isActive, true);

    await assert.rejects(
      () => service.createUser({ email: 'admin@example.com', password: 'password123' }),
      (err: unknown) => err instanceof AuthError && err.statusCode === 409,
    );
  });

  it('createUser rejects passwords shorter than 8 characters', async () => {
    await assert.rejects(
      () => service.createUser({ email: 'a@example.com', password: 'short' }),
      (err: unknown) => err instanceof AuthError && err.statusCode === 400,
    );
  });

  it('validateCredentials succeeds for correct password and returns null for wrong one', async () => {
    await service.createUser({ email: 'admin@example.com', password: 'password123' });
    const ok = await service.validateCredentials('admin@example.com', 'password123', '1.2.3.4');
    assert.ok(ok);
    const bad = await service.validateCredentials('admin@example.com', 'WRONG', '1.2.3.4');
    assert.equal(bad, null);
  });

  it('validateCredentials returns null for unknown email', async () => {
    const result = await service.validateCredentials('nobody@example.com', 'whatever', '1.2.3.4');
    assert.equal(result, null);
  });

  it('throttles repeated failures from same email+ip', async () => {
    await service.createUser({ email: 'admin@example.com', password: 'password123' });
    for (let i = 0; i < 3; i += 1) {
      await service.validateCredentials('admin@example.com', 'WRONG', '9.9.9.9');
    }
    // Even the correct password should be rejected during lockout.
    const result = await service.validateCredentials('admin@example.com', 'password123', '9.9.9.9');
    assert.equal(result, null);
  });

  it('different ip is not throttled by another ip\'s failures', async () => {
    await service.createUser({ email: 'admin@example.com', password: 'password123' });
    for (let i = 0; i < 3; i += 1) {
      await service.validateCredentials('admin@example.com', 'WRONG', '1.1.1.1');
    }
    const fromOtherIp = await service.validateCredentials('admin@example.com', 'password123', '2.2.2.2');
    assert.ok(fromOtherIp);
  });

  it('createSession + getSessionByToken returns session and user', async () => {
    const user = await service.createUser({ email: 'admin@example.com', password: 'password123' });
    const { sessionRecord, rawToken } = await service.createSession(user.id);
    assert.ok(rawToken.length > 20);
    assert.ok(sessionRecord.tokenHash);
    assert.equal(sessionRecord.userId, user.id);

    const found = await service.getSessionByToken(rawToken);
    assert.ok(found);
    assert.equal(found!.user.id, user.id);
    assert.equal(found!.session.id, sessionRecord.id);
  });

  it('getSessionByToken returns null for an invalid token', async () => {
    const found = await service.getSessionByToken('not-a-real-token');
    assert.equal(found, null);
  });

  it('revokeSessionByRawToken removes the session', async () => {
    const user = await service.createUser({ email: 'admin@example.com', password: 'password123' });
    const { rawToken } = await service.createSession(user.id);
    await service.revokeSessionByRawToken(rawToken);
    const found = await service.getSessionByToken(rawToken);
    assert.equal(found, null);
  });

  it('deactivated user is rejected even with a valid session', async () => {
    const user = await service.createUser({ email: 'admin@example.com', password: 'password123' });
    const { rawToken } = await service.createSession(user.id);
    await db.drizzleDb.update(users).set({ isActive: false }).where(eq(users.id, user.id));
    const found = await service.getSessionByToken(rawToken);
    assert.equal(found, null);
  });

  it('expired sessions are lazily deleted', async () => {
    const user = await service.createUser({ email: 'admin@example.com', password: 'password123' });
    const { rawToken } = await service.createSession(user.id, 60);
    await db.drizzleDb
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, user.id));
    const found = await service.getSessionByToken(rawToken);
    assert.equal(found, null);
    const remaining = await db.drizzleDb.select().from(sessions).where(eq(sessions.userId, user.id));
    assert.equal(remaining.length, 0);
  });

  it('updatePassword revokes all user sessions and old sessions are rejected', async () => {
    const user = await service.createUser({ email: 'admin@example.com', password: 'password123' });
    const { rawToken: tokenA } = await service.createSession(user.id);
    const { rawToken: tokenB } = await service.createSession(user.id);

    await service.updatePassword(user.id, 'newpassword456');

    assert.equal(await service.getSessionByToken(tokenA), null);
    assert.equal(await service.getSessionByToken(tokenB), null);

    // The new password authenticates.
    const ok = await service.validateCredentials('admin@example.com', 'newpassword456', '1.2.3.4');
    assert.ok(ok);
    const old = await service.validateCredentials('admin@example.com', 'password123', '1.2.3.4');
    assert.equal(old, null);
  });

  it('updatePassword rejects passwords shorter than 8 characters', async () => {
    const user = await service.createUser({ email: 'admin@example.com', password: 'password123' });
    await assert.rejects(
      () => service.updatePassword(user.id, 'short'),
      (err: unknown) => err instanceof AuthError && err.statusCode === 400,
    );
  });

  it('revokeSessionByHash removes the matching row', async () => {
    const user = await service.createUser({ email: 'admin@example.com', password: 'password123' });
    const { sessionRecord } = await service.createSession(user.id);
    await service.revokeSessionByHash(sessionRecord.tokenHash);
    const remaining = await db.drizzleDb.select().from(sessions).where(eq(sessions.userId, user.id));
    assert.equal(remaining.length, 0);
  });

  it('revokeAllUserSessions clears every session for a user', async () => {
    const user = await service.createUser({ email: 'admin@example.com', password: 'password123' });
    await service.createSession(user.id);
    await service.createSession(user.id);
    const before = await db.drizzleDb.select().from(sessions).where(eq(sessions.userId, user.id));
    assert.equal(before.length, 2);
    await service.revokeAllUserSessions(user.id);
    const after = await db.drizzleDb.select().from(sessions).where(eq(sessions.userId, user.id));
    assert.equal(after.length, 0);
  });

  it('deactivated user cannot validate credentials', async () => {
    const user = await service.createUser({ email: 'admin@example.com', password: 'password123' });
    await db.drizzleDb.update(users).set({ isActive: false }).where(eq(users.id, user.id));
    const result = await service.validateCredentials('admin@example.com', 'password123', '1.2.3.4');
    assert.equal(result, null);
  });
});
