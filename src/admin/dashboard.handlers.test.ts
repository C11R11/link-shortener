import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, type LinkService, type LinkRecord, type LinkStats } from '../app.js';
import type { AppConfig } from '../config.js';

const ADMIN_TOKEN = 'test-admin-token';

const baseConfig: AppConfig = {
  APP_PORT: 3000,
  SHORTENER_DOMAIN: 'localhost',
  SHORTENER_SCHEME: 'http',
  DATABASE_URL: 'postgres://shortener:shortener@db:5432/shortener',
  ADMIN_TOKEN,
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

function makeStats(overrides: Partial<LinkStats> = {}): LinkStats {
  return {
    link: makeLink(),
    totalClicks: 0,
    clicksLast7Days: 0,
    clicksByDay: [],
    clicksByHour: [],
    topReferrers: [],
    recentClicks: [],
    ...overrides,
  };
}

function makeLinkService(link: LinkRecord | null = null): LinkService {
  return {
    async listLinks() {
      return link ? [link] : [];
    },
    async getLinkBySlug() {
      return link;
    },
    async getLinkById() {
      return link;
    },
    async createLink(input) {
      return makeLink(input as Partial<LinkRecord>);
    },
    async updateLink() {
      return link;
    },
    async disableLink() {
      return link;
    },
    async recordClick() {},
    async getLinkStats() {
      return link ? makeStats({ link }) : null;
    },
  };
}

async function buildApp(service: LinkService = makeLinkService()) {
  const { app, ready } = createApp(baseConfig, service);
  await ready();
  return app;
}

describe('dashboard handlers', () => {
  it('returns 401 without admin token on /admin/dashboard', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard' });
    assert.equal(res.statusCode, 401);
  });

  it('returns 401 without admin token on /admin/dashboard/stats', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard/stats?period=7d' });
    assert.equal(res.statusCode, 401);
  });

  it('returns 401 without admin token on /admin/dashboard/links/:id/detail', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard/links/link-1/detail' });
    assert.equal(res.statusCode, 401);
  });

  it('renders dashboard html with admin token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/dashboard',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.includes('text/html'));
    assert.ok(res.body.includes('dashboard --live'));
  });

  it('renders stats fragment with admin token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/dashboard/stats?period=7d',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.includes('text/html'));
    assert.ok(res.body.includes('stats --summary'));
  });

  it('redirects POST /admin/links to /admin/dashboard?error=slug-exists on duplicate slug', async () => {
    const service = makeLinkService();
    service.createLink = async () => {
      const error = new Error('Slug already exists') as Error & { statusCode: number };
      error.statusCode = 409;
      throw error;
    };
    const app = await buildApp(service);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/links',
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'slug=demo&destinationUrl=https%3A%2F%2Fexample.com&redirectStatusCode=302',
    });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/admin/dashboard?error=slug-exists');
  });

  it('renders error banner text on GET /admin/dashboard?error=slug-exists', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/dashboard?error=slug-exists',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.includes('text/html'));
    assert.ok(res.body.includes('A link with that slug already exists'));
  });

  it('create form markup includes onsubmit handler that disables the submit button', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/dashboard',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(
      res.body.includes('onsubmit="this.querySelector(\'button[type=submit]\').disabled=true;this.querySelector(\'button[type=submit]\').textContent=\'creating...\'"'),
      'expected the create form to include an onsubmit handler that disables the submit button',
    );
  });
});
