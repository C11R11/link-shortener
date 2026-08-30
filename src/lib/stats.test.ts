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
    const links: Pick<LinkService, 'listLinks' | 'getLinkStats' | 'getAllRecentClicks'> = {
      listLinks: async () => [],
      getLinkStats: async () => null,
      getAllRecentClicks: async () => [],
    };
    const stats = createStatsService(links);
    const now = new Date('2026-07-13T15:42:00Z');
    const result = await stats.getGlobalStats('7d', { now });
    assert.equal(result.totalClicks, 0);
    assert.equal(result.activeLinks, 0);
    assert.equal(result.clicksPerDay, 0);
    assert.equal(result.topReferrer, '-');
    assert.equal(result.chartData.length, 7);
    assert.equal(result.chartData[0].bucket, '2026-07-07');
    assert.equal(result.chartData[6].bucket, '2026-07-13');
    assert.deepEqual(result.chartData, [
      { bucket: '2026-07-07', count: 0 },
      { bucket: '2026-07-08', count: 0 },
      { bucket: '2026-07-09', count: 0 },
      { bucket: '2026-07-10', count: 0 },
      { bucket: '2026-07-11', count: 0 },
      { bucket: '2026-07-12', count: 0 },
      { bucket: '2026-07-13', count: 0 },
    ]);
    assert.deepEqual(result.recentClicks, []);
  });

  it('returns 24 hourly buckets for period 24h sorted, zero-filled, and aggregated across links', async () => {
    const links: Pick<LinkService, 'listLinks' | 'getLinkStats' | 'getAllRecentClicks'> = {
      listLinks: async () => [makeLink({ id: 'a' }), makeLink({ id: 'b' })],
      getLinkStats: async (id) => {
        if (id === 'a') {
          return makeStats({
            totalClicks: 107,
            clicksByHour: [
              { bucket: '2026-07-13 15:00', count: 5 },
              { bucket: '2026-07-13 14:00', count: 3 },
              { bucket: '2026-07-12 10:00', count: 99 },
            ],
          });
        }
        return makeStats({
          totalClicks: 9,
          clicksByHour: [
            { bucket: '2026-07-13 15:00', count: 2 },
            { bucket: '2026-07-13 12:00', count: 7 },
          ],
        });
      },
      getAllRecentClicks: async () => [],
    };
    const stats = createStatsService(links);
    const now = new Date('2026-07-13T15:42:00Z');
    const result = await stats.getGlobalStats('24h', { now });

    assert.equal(result.chartData.length, 24);
    assert.equal(result.chartData[0].bucket, '2026-07-12 16:00');
    assert.equal(result.chartData[23].bucket, '2026-07-13 15:00');

    // Aggregated counts across links for shared buckets
    assert.equal(result.chartData[23].bucket, '2026-07-13 15:00');
    assert.equal(result.chartData[23].count, 7); // 5 (a) + 2 (b)
    assert.equal(result.chartData[22].bucket, '2026-07-13 14:00');
    assert.equal(result.chartData[22].count, 3);
    assert.equal(result.chartData[20].bucket, '2026-07-13 12:00');
    assert.equal(result.chartData[20].count, 7);

    // Zero-filled bucket between populated ones
    assert.equal(result.chartData[21].bucket, '2026-07-13 13:00');
    assert.equal(result.chartData[21].count, 0);
    assert.equal(result.chartData[19].bucket, '2026-07-13 11:00');
    assert.equal(result.chartData[19].count, 0);

    // Boundary exclusion: bucket older than 24h must not appear in chartData
    const outsideBucket = result.chartData.find((b) => b.bucket === '2026-07-12 10:00');
    assert.equal(outsideBucket, undefined);
    const buckets = result.chartData.map((b) => b.bucket);
    assert.ok(!buckets.includes('2026-07-12 10:00'));

    // Buckets are sorted ascending by time
    for (let i = 1; i < result.chartData.length; i++) {
      assert.ok(result.chartData[i - 1].bucket < result.chartData[i].bucket);
    }
  });

  it('fills missing daily buckets for 7d and 30d', async () => {
    const links: Pick<LinkService, 'listLinks' | 'getLinkStats' | 'getAllRecentClicks'> = {
      listLinks: async () => [makeLink({ id: 'a' })],
      getLinkStats: async () =>
        makeStats({
          totalClicks: 6,
          clicksByDay: [
            { bucket: '2026-07-13', count: 4 },
            { bucket: '2026-07-10', count: 2 },
          ],
        }),
      getAllRecentClicks: async () => [],
    };
    const stats = createStatsService(links);
    const now = new Date('2026-07-13T15:42:00Z');

    // 7d: 7 buckets from 2026-07-07 through 2026-07-13
    const sevenDay = await stats.getGlobalStats('7d', { now });
    assert.equal(sevenDay.chartData.length, 7);
    assert.equal(sevenDay.chartData[0].bucket, '2026-07-07');
    assert.equal(sevenDay.chartData[6].bucket, '2026-07-13');
    assert.equal(sevenDay.chartData[6].count, 4); // 2026-07-13
    assert.equal(sevenDay.chartData[3].bucket, '2026-07-10');
    assert.equal(sevenDay.chartData[3].count, 2); // 2026-07-10
    // Missing days are zero-filled
    for (const idx of [0, 1, 2, 4, 5]) {
      assert.equal(sevenDay.chartData[idx].count, 0, `expected zero at index ${idx}`);
    }

    // 30d: 30 buckets ending at 2026-07-13
    const thirtyDay = await stats.getGlobalStats('30d', { now });
    assert.equal(thirtyDay.chartData.length, 30);
    assert.equal(thirtyDay.chartData[0].bucket, '2026-06-14');
    assert.equal(thirtyDay.chartData[29].bucket, '2026-07-13');
    assert.equal(thirtyDay.chartData[29].count, 4); // 2026-07-13
    assert.equal(thirtyDay.chartData[26].bucket, '2026-07-10');
    assert.equal(thirtyDay.chartData[26].count, 2); // 2026-07-10
    // All other buckets are zero-filled
    for (let i = 0; i < 30; i++) {
      if (i === 26 || i === 29) continue;
      assert.equal(thirtyDay.chartData[i].count, 0, `expected zero at index ${i}`);
    }
  });

  it('aggregates totals across links', async () => {
    const recentRows = [
      {
        clickedAt: new Date('2026-07-13T12:00:00Z'),
        referrer: 'https://google.com',
        userAgent: 'Mozilla/5.0',
        country: 'AR',
        ipAddress: '127.0.0.1',
        linkId: 'a',
        linkSlug: 'slug-a',
        linkDestinationUrl: 'https://example.com/a',
      },
    ];
    const links: Pick<LinkService, 'listLinks' | 'getLinkStats' | 'getAllRecentClicks'> = {
      listLinks: async () => [makeLink({ id: 'a' }), makeLink({ id: 'b', status: 'archived' })],
      getLinkStats: async (id) =>
        id === 'a'
          ? makeStats({ totalClicks: 100, clicksLast7Days: 50, topReferrers: [{ referrer: 'google.com', count: 80 }] })
          : makeStats({ totalClicks: 20, topReferrers: [{ referrer: 'google.com', count: 20 }] }),
      getAllRecentClicks: async () => recentRows,
    };
    const stats = createStatsService(links);
    const result = await stats.getGlobalStats('7d');
    assert.equal(result.totalClicks, 120);
    assert.equal(result.activeLinks, 1);
    assert.equal(result.clicksPerDay, 17); // 120 / 7 rounded
    assert.equal(result.topReferrer, 'google.com');
    assert.deepEqual(result.recentClicks, recentRows);
  });
});
