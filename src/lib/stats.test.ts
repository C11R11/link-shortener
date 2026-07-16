import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStatsService, type StatsPeriod } from './stats.js';
import type { LinkService, LinkRecord, LinkStats } from '../app.js';

function makeLink(overrides: Partial<LinkRecord> = {}): LinkRecord {
  return {
    id: 'link-1',
    slug: 'test',
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
    createdAt: new Date(),
    updatedAt: new Date(),
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

describe('createStatsService', () => {
  it('returns zeroed global stats when no links', async () => {
    const links: Pick<LinkService, 'listLinks' | 'getLinkStats'> = {
      listLinks: async () => [],
      getLinkStats: async () => null,
    };
    const stats = createStatsService(links);
    const result = await stats.getGlobalStats('7d');
    assert.equal(result.totalClicks, 0);
    assert.equal(result.activeLinks, 0);
    assert.equal(result.clicksPerDay, 0);
    assert.equal(result.topReferrer, '-');
    assert.deepEqual(result.chartData, []);
  });

  it('aggregates totals across links', async () => {
    const links: Pick<LinkService, 'listLinks' | 'getLinkStats'> = {
      listLinks: async () => [makeLink({ id: 'a' }), makeLink({ id: 'b', status: 'archived' })],
      getLinkStats: async (id) =>
        id === 'a'
          ? makeStats({ totalClicks: 100, clicksLast7Days: 50, topReferrers: [{ referrer: 'google.com', count: 80 }] })
          : makeStats({ totalClicks: 20, topReferrers: [{ referrer: 'google.com', count: 20 }] }),
    };
    const stats = createStatsService(links);
    const result = await stats.getGlobalStats('7d');
    assert.equal(result.totalClicks, 120);
    assert.equal(result.activeLinks, 1);
    assert.equal(result.clicksPerDay, 17); // 120 / 7 rounded
    assert.equal(result.topReferrer, 'google.com');
  });
});
