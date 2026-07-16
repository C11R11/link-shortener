import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { LinkService } from '../app.js';
import { createStatsService, type StatsPeriod } from '../lib/stats.js';
import {
  layoutShell,
  renderHeader,
  renderKpiSection,
  renderChartSection,
  renderStatsFragment,
  renderCreateForm,
  renderLinksTable,
  renderLinkDetail,
  dashboardClientScripts,
} from './dashboard.components.js';

export type AuthGuard = (request: { headers: Record<string, unknown> }) => void;

export function registerDashboard(app: FastifyInstance, config: AppConfig, links: LinkService, requireAdmin: AuthGuard) {
  const statsService = createStatsService(links);

  app.get('/admin/dashboard', async (request, reply) => {
    requireAdmin(request);
    const items = await links.listLinks();
    const statsById = new Map(await Promise.all(items.map(async (item) => [item.id, await links.getLinkStats(item.id)] as const)));
    const period: StatsPeriod = '7d';

    const body = `<div class="dash__container">
      ${renderHeader(config)}
      ${renderKpiSection(await statsService.getGlobalStats(period))}
      ${renderChartSection(period)}
      ${renderCreateForm()}
      ${renderLinksTable(config, items, statsById)}
    </div>
    ${dashboardClientScripts()}`;

    return reply.type('text/html').send(layoutShell(config, body));
  });

  app.get('/admin/dashboard/stats', async (request, reply) => {
    requireAdmin(request);
    const period = normalizePeriod((request.query as { period?: string }).period);
    const stats = await statsService.getGlobalStats(period);
    return reply.type('text/html').send(renderStatsFragment(stats, period));
  });

  app.get('/admin/dashboard/links/:id/detail', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const stats = await links.getLinkStats(id);
    if (!stats) return reply.code(404).send('Not found');
    return reply.type('text/html').send(renderLinkDetail(stats, config));
  });
}

function normalizePeriod(input?: string): StatsPeriod {
  if (input === '24h' || input === '30d') return input;
  return '7d';
}
