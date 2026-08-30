import type { LinkService, LinkStats } from '../app.js';
import type { RecentClickRow } from './links.js';

export type StatsPeriod = '24h' | '7d' | '30d';

export type GlobalStats = {
  totalClicks: number;
  activeLinks: number;
  clicksPerDay: number;
  topReferrer: string;
  chartData: Array<{ bucket: string; count: number }>;
  recentClicks: RecentClickRow[];
};

export type GetGlobalStatsOptions = {
  now?: Date;
};

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatHourBucket(d: Date): string {
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const h = pad2(d.getUTCHours());
  return `${y}-${m}-${day} ${h}:00`;
}

function formatDayBucket(d: Date): string {
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  return `${y}-${m}-${day}`;
}

function buildBuckets(period: StatsPeriod, now: Date): Array<{ bucket: string; count: number }> {
  const buckets: Array<{ bucket: string; count: number }> = [];
  if (period === '24h') {
    const last = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      0, 0, 0,
    ));
    for (let i = 23; i >= 0; i--) {
      const d = new Date(last.getTime() - i * 60 * 60 * 1000);
      buckets.push({ bucket: formatHourBucket(d), count: 0 });
    }
  } else {
    const count = period === '7d' ? 7 : 30;
    const last = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0, 0, 0, 0,
    ));
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(last.getTime() - i * 24 * 60 * 60 * 1000);
      buckets.push({ bucket: formatDayBucket(d), count: 0 });
    }
  }
  return buckets;
}

export function createStatsService(links: Pick<LinkService, 'listLinks' | 'getLinkStats' | 'getAllRecentClicks'>) {
  return {
    async getGlobalStats(period: StatsPeriod, options?: GetGlobalStatsOptions): Promise<GlobalStats> {
      const now = options?.now ? new Date(options.now) : new Date();
      const days = period === '24h' ? 1 : period === '7d' ? 7 : 30;
      const items = await links.listLinks();
      const stats = await Promise.all(items.map((item) => links.getLinkStats(item.id)));

      const totalClicks = stats.reduce((sum, s) => sum + (s?.totalClicks ?? 0), 0);
      const activeLinks = items.filter((item) => item.status === 'active').length;
      const clicksPerDay = days > 0 ? Math.round(totalClicks / days) : 0;

      const referrerCounts = new Map<string, number>();
      for (const s of stats) {
        if (!s) continue;
        for (const { referrer, count } of s.topReferrers) {
          referrerCounts.set(referrer, (referrerCounts.get(referrer) ?? 0) + count);
        }
      }
      const topReferrer = [...referrerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';

      const chartMap = new Map<string, number>();
      for (const s of stats) {
        if (!s) continue;
        const rows = period === '24h' ? s.clicksByHour : s.clicksByDay;
        for (const { bucket, count } of rows) {
          chartMap.set(bucket, (chartMap.get(bucket) ?? 0) + count);
        }
      }
      const buckets = buildBuckets(period, now);
      const chartData = buckets.map(({ bucket }) => ({ bucket, count: chartMap.get(bucket) ?? 0 }));

      const recentClicks = await links.getAllRecentClicks(10);

      return { totalClicks, activeLinks, clicksPerDay, topReferrer, chartData, recentClicks };
    },
  };
}
