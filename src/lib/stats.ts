import type { LinkService, LinkStats } from '../app.js';

export type StatsPeriod = '24h' | '7d' | '30d';

export type GlobalStats = {
  totalClicks: number;
  activeLinks: number;
  clicksPerDay: number;
  topReferrer: string;
  chartData: Array<{ bucket: string; count: number }>;
};

export function createStatsService(links: Pick<LinkService, 'listLinks' | 'getLinkStats'>) {
  return {
    async getGlobalStats(period: StatsPeriod): Promise<GlobalStats> {
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
        for (const { bucket, count } of s.clicksByDay) {
          chartMap.set(bucket, (chartMap.get(bucket) ?? 0) + count);
        }
      }
      const chartData = [...chartMap.entries()].sort().slice(-days).map(([bucket, count]) => ({ bucket, count }));

      return { totalClicks, activeLinks, clicksPerDay, topReferrer, chartData };
    },
  };
}
