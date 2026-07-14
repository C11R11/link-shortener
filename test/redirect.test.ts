import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, type LinkService, type LinkRecord } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

const baseConfig: AppConfig = {
  APP_PORT: 3000,
  SHORTENER_DOMAIN: 'test.local',
  SHORTENER_SCHEME: 'http',
  DATABASE_URL: 'postgres://shortener:shortener@db:5432/shortener',
  ADMIN_TOKEN: 'change-me',
  REDIRECT_STATUS_CODE: 302,
};

function makeLink(overrides: Partial<LinkRecord> = {}): LinkRecord {
  return {
    id: 'link-1',
    slug: 'demo',
    destinationUrl: 'https://example.com',
    redirectStatusCode: 302,
    title: null,
    description: null,
    status: 'active',
    clickCount: 0,
    lastClickedAt: null,
    createdBy: null,
    expiresAt: null,
    deletedAt: null,
    createdAt: new Date('2026-07-13T00:00:00Z'),
    updatedAt: new Date('2026-07-13T00:00:00Z'),
    ...overrides,
  };
}

function makeService(link: LinkRecord | null): LinkService & { recordClickCalls: number } {
  return {
    recordClickCalls: 0,
    async listLinks() {
      return link ? [link] : [];
    },
    async getLinkBySlug() {
      return link;
    },
    async getLinkById() {
      return link;
    },
    async createLink() {
      return makeLink();
    },
    async updateLink() {
      return link;
    },
    async disableLink() {
      return link;
    },
    async recordClick() {
      this.recordClickCalls += 1;
    },
    async getLinkStats() {
      return link ? { link, recentClicks: [] } : null;
    },
  };
}

test('redirects use the per-link status code', async () => {
  for (const statusCode of [301, 302, 307, 308] as const) {
    const link = makeLink({ redirectStatusCode: statusCode });
    const service = makeService(link);
    const { app, ready } = createApp(baseConfig, service);
    await ready();

    const response = await app.inject({ method: 'GET', url: '/demo' });

    assert.equal(response.statusCode, statusCode);
    assert.equal(response.headers.location, 'https://example.com');
    assert.equal(service.recordClickCalls, 1);
  }
});

test('returns 410 for disabled links', async () => {
  const link = makeLink({ status: 'disabled' });
  const service = makeService(link);
  const { app, ready } = createApp(baseConfig, service);
  await ready();

  const response = await app.inject({ method: 'GET', url: '/demo' });

  assert.equal(response.statusCode, 410);
  assert.match(response.payload, /Link disabled/);
  assert.equal(service.recordClickCalls, 0);
});

test('returns 410 for expired links', async () => {
  const link = makeLink({ expiresAt: new Date('2026-07-12T00:00:00Z') });
  const service = makeService(link);
  const { app, ready } = createApp(baseConfig, service);
  await ready();

  const response = await app.inject({ method: 'GET', url: '/demo' });

  assert.equal(response.statusCode, 410);
  assert.match(response.payload, /Link expired/);
  assert.equal(service.recordClickCalls, 0);
});

test('returns 404 for unknown slugs', async () => {
  const service = makeService(null);
  const { app, ready } = createApp(baseConfig, service);
  await ready();

  const response = await app.inject({ method: 'GET', url: '/missing' });

  assert.equal(response.statusCode, 404);
  assert.match(response.payload, /Link not found/);
  assert.equal(service.recordClickCalls, 0);
});

