import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { LinkService } from '../app.js';
import type { RequireAdmin } from '../auth/middleware.js';
import { getOrCreateCsrfToken } from '../auth/csrf.js';
import { createStatsService, type StatsPeriod } from '../lib/stats.js';
import {
  layoutShell,
  renderHeader,
  renderStatsContainer,
  renderCreateForm,
  renderLinksTable,
  renderLinkDetail,
} from './dashboard.components.js';

export function registerDashboard(app: FastifyInstance, config: AppConfig, links: LinkService, guards: Pick<RequireAdmin, 'requireAdminHtml'>) {
  const statsService = createStatsService(links);

  app.get('/admin/dashboard', { preHandler: guards.requireAdminHtml }, async (request, reply) => {
    const items = await links.listLinks();
    const statsById = new Map(await Promise.all(items.map(async (item) => [item.id, await links.getLinkStats(item.id)] as const)));
    const period: StatsPeriod = '7d';
    const error = (request.query as { error?: string }).error;
    const csrfToken = getOrCreateCsrfToken(request, reply, config);

    const body = `<div class="dash__container">
      ${renderHeader(config)}
      ${renderStatsContainer(config, await statsService.getGlobalStats(period), period)}
      ${renderCreateForm(error, csrfToken)}
      ${renderLinksTable(config, items, statsById)}
    </div>`;

    return reply.type('text/html').send(layoutShell(config, body));
  });

  app.get('/admin/dashboard/stats', { preHandler: guards.requireAdminHtml }, async (request, reply) => {
    const period = normalizePeriod((request.query as { period?: string }).period);
    const stats = await statsService.getGlobalStats(period);
    return reply.header('Cache-Control', 'no-store').type('text/html').send(renderStatsContainer(config, stats, period));
  });

  app.get('/admin/dashboard/links/:id/detail', { preHandler: guards.requireAdminHtml }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const csrfToken = getOrCreateCsrfToken(request, reply, config);
    const stats = await links.getLinkStats(id);
    if (!stats) return reply.code(404).send('Not found');
    return reply.header('Cache-Control', 'no-store').type('text/html').send(renderLinkDetail(stats, config, csrfToken));
  });
}

function normalizePeriod(input?: string): StatsPeriod {
  if (input === '24h' || input === '30d') return input;
  return '7d';
}
