import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { users, sessions, userRelations, sessionRelations } from './schema.js';

describe('db schema (users + sessions)', () => {
  it('imports users and sessions table definitions', () => {
    assert.ok(users, 'users table is exported');
    assert.ok(sessions, 'sessions table is exported');
    assert.equal(typeof users, 'object');
    assert.equal(typeof sessions, 'object');
  });

  it('users table exposes the expected columns', () => {
    const cols = users as unknown as Record<string, unknown>;
    assert.ok(cols.id, 'users.id is defined');
    assert.ok(cols.email, 'users.email is defined');
    assert.ok(cols.passwordHash, 'users.passwordHash is defined');
    assert.ok(cols.role, 'users.role is defined');
    assert.ok(cols.isActive, 'users.isActive is defined');
    assert.ok(cols.createdAt, 'users.createdAt is defined');
    assert.ok(cols.updatedAt, 'users.updatedAt is defined');
  });

  it('sessions table exposes the expected columns', () => {
    const cols = sessions as unknown as Record<string, unknown>;
    assert.ok(cols.id, 'sessions.id is defined');
    assert.ok(cols.userId, 'sessions.userId is defined');
    assert.ok(cols.tokenHash, 'sessions.tokenHash is defined');
    assert.ok(cols.expiresAt, 'sessions.expiresAt is defined');
    assert.ok(cols.createdAt, 'sessions.createdAt is defined');
  });

  it('exports relation definitions for users and sessions', () => {
    assert.equal(typeof userRelations, 'object');
    assert.equal(typeof sessionRelations, 'object');
    assert.ok(userRelations !== null);
    assert.ok(sessionRelations !== null);
  });
});
