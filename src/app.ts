import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';
import { getBaseUrl, type AppConfig } from './config.js';

export type LinkRecord = {
  id: string;
  slug: string;
  destinationUrl: string;
  redirectStatusCode: number;
  title?: string | null;
  description?: string | null;
  status: string;
  clickCount: number;
  lastClickedAt: Date | null;
  createdBy?: string | null;
  expiresAt?: Date | null;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type LinkStats = {
  link: LinkRecord;
  totalClicks: number;
  clicksLast7Days: number;
  clicksByDay: Array<{
    bucket: string;
    count: number;
  }>;
  clicksByHour: Array<{
    bucket: string;
    count: number;
  }>;
  topReferrers: Array<{
    referrer: string;
    count: number;
  }>;
  recentClicks: Array<{
    clickedAt: Date;
    referrer: string | null;
    userAgent: string | null;
    country: string | null;
  }>;
};

export type LinkService = {
  listLinks(): Promise<LinkRecord[]>;
  getLinkBySlug(slug: string): Promise<LinkRecord | null>;
  getLinkById(id: string): Promise<LinkRecord | null>;
  createLink(input: {
    slug: string;
    destinationUrl: string;
    redirectStatusCode: number;
    title?: string | null;
    description?: string | null;
    createdBy?: string | null;
    expiresAt?: Date | null;
  }): Promise<LinkRecord>;
  updateLink(
    id: string,
    patch: Partial<{
      slug: string;
      destinationUrl: string;
      redirectStatusCode: number;
      title: string | null;
      description: string | null;
      createdBy: string | null;
      expiresAt: Date | null;
      status: string | null;
    }>,
  ): Promise<LinkRecord | null>;
  disableLink(id: string): Promise<LinkRecord | null>;
  recordClick(
    link: LinkRecord,
    event: { referrer?: string | null; userAgent?: string | null; country?: string | null; ipHash?: string | null },
  ): Promise<void>;
  getLinkStats(id: string): Promise<LinkStats | null>;
};

export function createApp(config: AppConfig, links: LinkService) {
  const app = Fastify({ logger: true });
  const registerHelmet = async () => {
    if (config.SHORTENER_SCHEME === 'http') {
      await app.register(helmet, { contentSecurityPolicy: false });
    } else {
      await app.register(helmet);
    }
  };

  const setup = async () => {
    await registerHelmet();
    await app.register(formbody);
    await app.register(rateLimit, {
      global: true,
      max: 120,
      timeWindow: '1 minute',
    });
  };

  const isAuthorized = (request: { headers: Record<string, unknown> }) => {
    const header = request.headers.authorization;
    if (typeof header !== 'string') {
      return false;
    }

    if (header === `Bearer ${config.ADMIN_TOKEN}`) {
      return true;
    }

    if (header.startsWith('Basic ')) {
      const encoded = header.slice(6);
      try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const [, password] = decoded.split(':', 2);
        return password === config.ADMIN_TOKEN;
      } catch {
        return false;
      }
    }

    return false;
  };

  const requireAdmin = (request: { headers: Record<string, unknown> }) => {
    if (!isAuthorized(request)) {
      const error = new Error('Unauthorized');
      // @ts-expect-error Fastify decorations are runtime-only here
      error.statusCode = 401;
      throw error;
    }
  };

  app.get('/healthz', async () => ({
    ok: true,
    service: 'link-shortener',
    baseUrl: getBaseUrl(config),
  }));

  app.get('/api/links', async () => {
    const items = await links.listLinks();
    return {
      items,
      baseUrl: getBaseUrl(config),
    };
  });

  app.post('/api/links', async (request, reply) => {
    requireAdmin(request);
    const body = request.body as {
      slug?: string;
      destinationUrl?: string;
      redirectStatusCode?: string | number;
      title?: string;
      description?: string;
      createdBy?: string;
      expiresAt?: string;
    };

    if (!body?.slug || !body?.destinationUrl) {
      return reply.code(400).send({ error: 'slug and destinationUrl are required' });
    }

    if (!/^https?:\/\//i.test(body.destinationUrl)) {
      return reply.code(400).send({ error: 'destinationUrl must start with http:// or https://' });
    }

    const created = await links.createLink({
      slug: body.slug.trim(),
      destinationUrl: body.destinationUrl.trim(),
      redirectStatusCode: normalizeRedirectCode(body.redirectStatusCode, config.REDIRECT_STATUS_CODE),
      title: body.title?.trim() || null,
      description: body.description?.trim() || null,
      createdBy: body.createdBy?.trim() || null,
      expiresAt: parseDateTimeLocal(body.expiresAt),
    });

    return reply.code(201).send({
      ...created,
      shortUrl: `${getBaseUrl(config)}/${created.slug}`,
    });
  });

  app.get('/api/links/:id', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const link = await links.getLinkById(id);
    if (!link) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    return {
      ...link,
      shortUrl: `${getBaseUrl(config)}/${link.slug}`,
    };
  });

  app.get('/admin/dashboard', async (request, reply) => {
    requireAdmin(request);
    const items = await links.listLinks();
    const statsById = new Map(
      await Promise.all(
        items.map(async (item) => [item.id, await links.getLinkStats(item.id)] as const),
      ),
    );

    const options = [301, 302, 307, 308]
      .map((code) => `<option value="${code}"${code === config.REDIRECT_STATUS_CODE ? ' selected' : ''}>${code}</option>`)
      .join('');

    const rows = items.map((item) => {
      const stats = statsById.get(item.id);
      const statsSummaryHtml = stats ? renderStatsSummary(stats) : renderEmptyStatsSummary();
      const timelineHtml = stats ? renderClickTimeline(stats) : renderEmptyTimeline();
      const referrerHtml = stats ? renderReferrerList(stats.topReferrers, stats.totalClicks) : renderEmptyReferrerList();
      return `
      <tr>
        <td>
          <div><strong>${escapeHtml(item.slug)}</strong></div>
          <div class="muted">${escapeHtml(item.id)}</div>
        </td>
        <td><a href="${escapeHtml(`${getBaseUrl(config)}/${item.slug}`)}" target="_blank" rel="noreferrer">${escapeHtml(`${getBaseUrl(config)}/${item.slug}`)}</a></td>
        <td>${escapeHtml(item.destinationUrl)}</td>
        <td>${item.redirectStatusCode}</td>
        <td>${escapeHtml(item.status)}</td>
        <td class="stats-cell">
          ${statsSummaryHtml}
          <div class="stats-note muted">${escapeHtml(formatDisplayDate(stats?.link.lastClickedAt ?? item.lastClickedAt))}</div>
          <details class="stats-details">
            <summary>Ver distribución</summary>
            <div class="stats-panels">
              ${timelineHtml}
            </div>
            <section class="referrer-panel">
              <h3>Referidos</h3>
              ${referrerHtml}
            </section>
          </details>
        </td>
        <td>
          <details>
            <summary>Edit</summary>
            <form method="post" action="/admin/links/${item.id}" class="edit-form">
              <input type="hidden" name="_method" value="patch" />
              <label>Slug
                <input name="slug" value="${escapeHtml(item.slug)}" />
              </label>
              <label>Destination URL
                <input name="destinationUrl" value="${escapeHtml(item.destinationUrl)}" />
              </label>
              <label>Redirect status code
                <select name="redirectStatusCode">
                  ${[301, 302, 307, 308].map((code) => `<option value="${code}"${code === item.redirectStatusCode ? ' selected' : ''}>${code}</option>`).join('')}
                </select>
              </label>
              <label>Status
                <select name="status">
                  ${['active', 'disabled', 'archived'].map((status) => `<option value="${status}"${status === item.status ? ' selected' : ''}>${status}</option>`).join('')}
                </select>
              </label>
              <label>Expiry
                <input type="datetime-local" name="expiresAt" value="${formatDateTimeLocal(item.expiresAt)}" />
              </label>
              <label>Title
                <input name="title" value="${escapeHtml(item.title ?? '')}" />
              </label>
              <label>Description
                <input name="description" value="${escapeHtml(item.description ?? '')}" />
              </label>
              <label>Created by
                <input name="createdBy" value="${escapeHtml(item.createdBy ?? '')}" />
              </label>
              <button type="submit">Save</button>
            </form>
          </details>
        </td>
      </tr>
      `;
    }).join('');

    const html = `<!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Link Shortener Admin</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 0; background: #0b0f14; color: #e8eef6; }
          main { max-width: 1200px; margin: 0 auto; padding: 32px 20px 60px; }
          h1, h2 { margin: 0 0 16px; }
          .panel { background: #111823; border: 1px solid #243042; border-radius: 16px; padding: 20px; margin-bottom: 20px; }
          form { display: grid; gap: 12px; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
          label { display: grid; gap: 6px; font-size: 14px; color: #b6c1cf; }
          input, select { background: #0d141d; color: #e8eef6; border: 1px solid #2b3950; border-radius: 10px; padding: 10px 12px; }
          button { background: #7dd3fc; color: #081018; border: 0; border-radius: 10px; padding: 10px 14px; font-weight: 700; cursor: pointer; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px 8px; border-bottom: 1px solid #243042; text-align: left; vertical-align: top; }
          th { color: #8ea1b6; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
          .inline-form { display: flex; gap: 8px; align-items: center; }
          .inline-form select, .inline-form button { padding: 8px 10px; }
          details { max-width: 420px; }
          summary { cursor: pointer; color: #7dd3fc; font-weight: 700; margin-bottom: 10px; }
          .edit-form { margin-top: 10px; display: grid; gap: 10px; }
          a { color: #7dd3fc; }
          .muted { color: #8ea1b6; }
          .stats-cell { min-width: 360px; }
          .stats-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 10px;
          }
          .stats-summary-empty { opacity: 0.9; }
          .stats-metric {
            background: #0d141d;
            border: 1px solid #243042;
            border-radius: 12px;
            padding: 10px 12px;
            display: grid;
            gap: 4px;
          }
          .stats-metric span {
            color: #8ea1b6;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: .08em;
          }
          .stats-metric strong {
            color: #e8eef6;
            font-size: 13px;
            line-height: 1.2;
            word-break: break-word;
          }
          .stats-metric small {
            color: #8ea1b6;
            font-size: 11px;
          }
          .stats-note { margin-top: 10px; }
          .stats-details { margin-top: 14px; max-width: 100%; }
          .stats-details summary { margin-bottom: 12px; }
          .stats-panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
          .chart-panel, .referrer-panel {
            background: #0d141d;
            border: 1px solid #243042;
            border-radius: 14px;
            padding: 12px;
          }
          .chart-panel h3, .referrer-panel h3 {
            margin: 0 0 10px;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: .08em;
            color: #8ea1b6;
          }
          .chart-shell { display: grid; gap: 8px; }
          .chart-caption { display: flex; justify-content: space-between; gap: 12px; color: #8ea1b6; font-size: 12px; }
          .chart-svg { width: 100%; height: auto; overflow: visible; }
          .chart-axis { fill: #8ea1b6; font-size: 10px; }
          .chart-bar { fill: #7dd3fc; }
          .chart-bar-empty { fill: #243042; }
          .referrer-list { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
          .referrer-list li { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
          .referrer-main { display: grid; gap: 2px; min-width: 0; }
          .referrer-list code { color: #e8eef6; font-size: 13px; }
          .referrer-list small { color: #8ea1b6; font-size: 11px; }
          .referrer-list strong { color: #7dd3fc; }
          @media (max-width: 900px) {
            .stats-cell { min-width: 280px; }
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Link Shortener Admin</h1>
          <p class="muted">Base URL: ${escapeHtml(getBaseUrl(config))}</p>

          <section class="panel">
            <h2>Create link</h2>
            <form method="post" action="/admin/links">
              <div class="grid">
                <label>Slug
                  <input name="slug" placeholder="summer-camp" required />
                </label>
                <label>Destination URL
                  <input name="destinationUrl" placeholder="https://example.com" required />
                </label>
                <label>Redirect status code
                  <select name="redirectStatusCode">
                    ${options}
                  </select>
                </label>
                <label>Status
                  <select name="status">
                    <option value="active" selected>active</option>
                    <option value="disabled">disabled</option>
                    <option value="archived">archived</option>
                  </select>
                </label>
                <label>Title
                  <input name="title" placeholder="Campaign name" />
                </label>
                <label>Expiry
                  <input type="datetime-local" name="expiresAt" />
                </label>
              </div>
              <label>Description
                <input name="description" placeholder="Optional notes" />
              </label>
              <button type="submit">Create link</button>
            </form>
          </section>

          <section class="panel">
            <h2>Existing links</h2>
            <table>
              <thead>
                <tr>
                  <th>Slug</th>
                  <th>Short URL</th>
                  <th>Destination</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Stats</th>
                  <th>Update</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="7" class="muted">No links yet.</td></tr>'}</tbody>
            </table>
          </section>
        </main>
      </body>
    </html>`;

    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.patch('/api/links/:id', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = request.body as {
      slug?: string;
      destinationUrl?: string;
      redirectStatusCode?: number;
      title?: string | null;
      description?: string | null;
      createdBy?: string | null;
      expiresAt?: string | null;
      status?: 'active' | 'disabled' | 'archived';
    };

    const updated = await links.updateLink(id, {
      ...(body.slug !== undefined ? { slug: body.slug.trim() } : {}),
      ...(body.destinationUrl !== undefined ? { destinationUrl: body.destinationUrl.trim() } : {}),
      ...(body.redirectStatusCode !== undefined ? { redirectStatusCode: normalizeRedirectCode(body.redirectStatusCode, config.REDIRECT_STATUS_CODE) } : {}),
      ...(body.title !== undefined ? { title: body.title?.trim() ?? null } : {}),
      ...(body.description !== undefined ? { description: body.description?.trim() ?? null } : {}),
      ...(body.createdBy !== undefined ? { createdBy: body.createdBy?.trim() ?? null } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: parseDateTimeLocal(body.expiresAt) } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });

    if (!updated) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    return {
      ...updated,
      shortUrl: `${getBaseUrl(config)}/${updated.slug}`,
    };
  });

  app.delete('/api/links/:id', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const disabled = await links.disableLink(id);
    if (!disabled) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    return reply.code(204).send();
  });

  app.get('/api/links/:id/stats', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const stats = await links.getLinkStats(id);
    if (!stats) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    return {
      ...stats,
      shortUrl: `${getBaseUrl(config)}/${stats.link.slug}`,
    };
  });

  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    if (!slug || slug.startsWith('api/') || slug === 'healthz' || slug.startsWith('admin/')) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const link = await links.getLinkBySlug(slug);
    if (!link) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    if (link.status !== 'active') {
      return reply.code(410).send({ error: 'Link disabled' });
    }

    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
      return reply.code(410).send({ error: 'Link expired' });
    }

    await links.recordClick(link, {
      referrer: request.headers.referer ?? null,
      userAgent: request.headers['user-agent'] ?? null,
      country: typeof request.headers['cf-ipcountry'] === 'string' ? request.headers['cf-ipcountry'] : null,
      ipHash: request.ip ? crypto.createHash('sha256').update(request.ip).digest('hex') : null,
    });

    reply.code(link.redirectStatusCode || config.REDIRECT_STATUS_CODE);
    return reply.redirect(link.destinationUrl);
  });

  app.post('/admin/links', async (request, reply) => {
    requireAdmin(request);
    const body = request.body as {
      slug?: string;
      destinationUrl?: string;
      redirectStatusCode?: string | number;
      title?: string;
      description?: string;
      status?: 'active' | 'disabled' | 'archived';
      createdBy?: string;
      expiresAt?: string;
    };

    if (!body?.slug || !body?.destinationUrl) {
      return reply.code(400).send({ error: 'slug and destinationUrl are required' });
    }

    if (!/^https?:\/\//i.test(body.destinationUrl)) {
      return reply.code(400).send({ error: 'destinationUrl must start with http:// or https://' });
    }

    const created = await links.createLink({
      slug: body.slug.trim(),
      destinationUrl: body.destinationUrl.trim(),
      redirectStatusCode: normalizeRedirectCode(body.redirectStatusCode, config.REDIRECT_STATUS_CODE),
      title: body.title?.trim() || null,
      description: body.description?.trim() || null,
      createdBy: body.createdBy?.trim() || null,
      expiresAt: parseDateTimeLocal(body.expiresAt),
    });

    if (body.status && body.status !== 'active') {
      await links.updateLink(created.id, { status: body.status });
    }

    return reply.redirect('/admin/dashboard');
  });

  app.post('/admin/links/:id', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = request.body as {
      slug?: string;
      destinationUrl?: string;
      redirectStatusCode?: string | number;
      title?: string | null;
      description?: string | null;
      createdBy?: string | null;
      expiresAt?: string | null;
      status?: 'active' | 'disabled' | 'archived';
      _method?: string;
    };

    const updated = await links.updateLink(id, {
      ...(body.slug !== undefined ? { slug: body.slug.trim() } : {}),
      ...(body.destinationUrl !== undefined ? { destinationUrl: body.destinationUrl.trim() } : {}),
      ...(body.redirectStatusCode !== undefined ? { redirectStatusCode: normalizeRedirectCode(body.redirectStatusCode, config.REDIRECT_STATUS_CODE) } : {}),
      ...(body.title !== undefined ? { title: body.title?.trim() ?? null } : {}),
      ...(body.description !== undefined ? { description: body.description?.trim() ?? null } : {}),
      ...(body.createdBy !== undefined ? { createdBy: body.createdBy?.trim() ?? null } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: parseDateTimeLocal(body.expiresAt) } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });

    if (!updated) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    return reply.redirect('/admin/dashboard');
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, 'request failed');

    const typedError = error as { statusCode?: number; message?: string };
    const statusCode = typeof typedError.statusCode === 'number'
      ? typedError.statusCode
      : 500;

    if (statusCode === 401) {
      reply.header('WWW-Authenticate', 'Basic realm="Link Shortener Admin"');
    }

    reply.code(statusCode).send({
      error: statusCode === 500 ? 'Internal Server Error' : (typedError.message ?? 'Error'),
    });
  });

  return {
    app,
    ready: setup,
  };
}

function normalizeRedirectCode(value: string | number | undefined | null, fallback: number): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (numeric === 301 || numeric === 302 || numeric === 307 || numeric === 308) {
    return numeric;
  }

  return fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseDateTimeLocal(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTimeLocal(value: Date | null | undefined): string {
  if (!value) {
    return '';
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatDisplayDate(value: Date | null | undefined): string {
  if (!value) {
    return 'Last click: n/a';
  }

  return `Last click: ${value.toLocaleString('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`;
}

function renderStatsSummary(stats: LinkStats): string {
  const daily = buildBucketSeries(stats.clicksByDay, 14, 'day');
  const hourly = buildBucketSeries(stats.clicksByHour, 24, 'hour');
  const peakDay = findPeakPoint(daily);
  const peakHour = findPeakPoint(hourly);
  const topReferrer = stats.topReferrers[0];

  return `
    <div class="stats-summary">
      <div class="stats-metric">
        <span>Total</span>
        <strong>${stats.totalClicks}</strong>
      </div>
      <div class="stats-metric">
        <span>Últimos 7 días</span>
        <strong>${stats.clicksLast7Days}</strong>
      </div>
      <div class="stats-metric">
        <span>Pico por día</span>
        <strong>${escapeHtml(peakDay ? peakDay.label : 'n/a')}</strong>
        <small>${peakDay?.count ?? 0} clicks</small>
      </div>
      <div class="stats-metric">
        <span>Pico por hora</span>
        <strong>${escapeHtml(peakHour ? peakHour.label : 'n/a')}</strong>
        <small>${peakHour?.count ?? 0} clicks</small>
      </div>
      <div class="stats-metric">
        <span>Top referido</span>
        <strong>${escapeHtml(topReferrer?.referrer ?? 'n/a')}</strong>
        <small>${topReferrer ? `${topReferrer.count} clicks` : 'Sin datos'}</small>
      </div>
    </div>
  `;
}

function renderEmptyStatsSummary(): string {
  return `
    <div class="stats-summary stats-summary-empty">
      <div class="stats-metric">
        <span>Total</span>
        <strong>0</strong>
      </div>
      <div class="stats-metric">
        <span>Últimos 7 días</span>
        <strong>0</strong>
      </div>
      <div class="stats-metric">
        <span>Pico por día</span>
        <strong>n/a</strong>
        <small>Sin clicks</small>
      </div>
      <div class="stats-metric">
        <span>Pico por hora</span>
        <strong>n/a</strong>
        <small>Sin clicks</small>
      </div>
      <div class="stats-metric">
        <span>Top referido</span>
        <strong>n/a</strong>
        <small>Sin datos</small>
      </div>
    </div>
  `;
}

function renderClickTimeline(stats: LinkStats): string {
  const daily = buildBucketSeries(stats.clicksByDay, 14, 'day');
  const hourly = buildBucketSeries(stats.clicksByHour, 24, 'hour');

  return `
    <section class="chart-panel">
      <h3>Clicks por día (UTC)</h3>
      ${renderHistogram(daily, 320, 140, 'días')}
    </section>
    <section class="chart-panel">
      <h3>Clicks por hora (UTC)</h3>
      ${renderHistogram(hourly, 420, 140, 'horas')}
    </section>
  `;
}

function renderEmptyTimeline(): string {
  return `
    <section class="chart-panel">
      <h3>Clicks por día (UTC)</h3>
      <p class="muted">Todavía no hay clicks.</p>
    </section>
    <section class="chart-panel">
      <h3>Clicks por hora (UTC)</h3>
      <p class="muted">Todavía no hay clicks.</p>
    </section>
  `;
}

function findPeakPoint(points: Array<{ label: string; count: number }>): { label: string; count: number } | null {
  const peak = points.reduce<{ label: string; count: number } | null>((current, point) => {
    if (!current || point.count > current.count) {
      return point;
    }

    return current;
  }, null);

  return peak && peak.count > 0 ? peak : null;
}

function renderHistogram(points: Array<{ label: string; count: number }>, width: number, height: number, axisLabel: string): string {
  const maxValue = Math.max(...points.map((point) => point.count), 1);
  const paddingTop = 12;
  const paddingRight = 10;
  const paddingBottom = 28;
  const paddingLeft = 10;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const barWidth = plotWidth / Math.max(points.length, 1);

  const bars = points.map((point, index) => {
    const barHeight = point.count === 0 ? 0 : Math.max(4, (point.count / maxValue) * plotHeight);
    const x = paddingLeft + (index * barWidth) + 2;
    const y = paddingTop + plotHeight - barHeight;
    const labelX = x + (barWidth - 4) / 2;
    const showLabel = points.length <= 14 || index % Math.max(1, Math.ceil(points.length / 7)) === 0;
    return `
      <g>
        <title>${escapeHtml(`${point.label}: ${point.count} clicks`)}</title>
        <rect class="${point.count > 0 ? 'chart-bar' : 'chart-bar-empty'}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(barWidth - 4, 2).toFixed(2)}" height="${barHeight.toFixed(2)}" rx="5" />
        ${showLabel ? `<text class="chart-axis" x="${labelX.toFixed(2)}" y="${height - 10}" text-anchor="middle">${escapeHtml(point.label)}</text>` : ''}
      </g>
    `;
  }).join('');

  return `
    <div class="chart-shell">
      <div class="chart-caption">
        <span>${escapeHtml(axisLabel)}</span>
        <span>${points.reduce((sum, point) => sum + point.count, 0)} clicks</span>
      </div>
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Histograma de clicks por ${escapeHtml(axisLabel)}">
        ${bars}
      </svg>
    </div>
  `;
}

function renderReferrerList(rows: Array<{ referrer: string; count: number }>, totalClicks: number): string {
  if (rows.length === 0) {
    return '<p class="muted">Sin referidos.</p>';
  }

  return `
    <ul class="referrer-list">
      ${rows
        .map((row) => `
          <li>
            <div class="referrer-main">
              <code>${escapeHtml(row.referrer)}</code>
              <small>${formatShare(row.count, totalClicks)}</small>
            </div>
            <strong>${row.count}</strong>
          </li>
        `)
        .join('')}
    </ul>
  `;
}

function renderEmptyReferrerList(): string {
  return '<p class="muted">Sin referidos.</p>';
}

function formatShare(value: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }

  return `${((value / total) * 100).toFixed(1)}%`;
}

function buildBucketSeries(
  rows: Array<{ bucket: string; count: number }>,
  totalBuckets: number,
  granularity: 'day' | 'hour',
): Array<{ label: string; count: number }> {
  const map = new Map(rows.map((row) => [row.bucket, Number(row.count)]));
  const result: Array<{ label: string; count: number }> = [];
  const now = new Date();

  for (let index = totalBuckets - 1; index >= 0; index -= 1) {
    const bucketDate = granularity === 'day'
      ? shiftUtcDay(now, index)
      : shiftUtcHour(now, index);
    result.push({
      label: granularity === 'day' ? formatUtcDayLabel(bucketDate) : formatUtcHourLabel(bucketDate),
      count: map.get(formatUtcBucket(bucketDate, granularity)) ?? 0,
    });
  }

  return result;
}

function shiftUtcDay(now: Date, offset: number): Date {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - offset);
  return date;
}

function shiftUtcHour(now: Date, offset: number): Date {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
  date.setUTCHours(date.getUTCHours() - offset);
  return date;
}

function formatUtcBucket(date: Date, granularity: 'day' | 'hour'): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  if (granularity === 'day') {
    return `${year}-${month}-${day}`;
  }

  const hour = String(date.getUTCHours()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:00`;
}

function formatUtcDayLabel(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatUtcHourLabel(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, '0')}h`;
}
