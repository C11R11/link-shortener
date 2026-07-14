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

    const cards = items.map((item) => {
      const stats = statsById.get(item.id);
      const statsSummaryHtml = stats ? renderStatsSummary(stats) : renderEmptyStatsSummary();
      const timelineHtml = stats ? renderClickTimeline(stats) : renderEmptyTimeline();
      const referrerHtml = stats ? renderReferrerList(stats.topReferrers, stats.totalClicks) : renderEmptyReferrerList();
      return `
      <article class="link-card">
        <div class="link-card__top">
          <div class="link-card__identity">
            <div class="link-card__slug-row">
              <strong>${escapeHtml(item.slug)}</strong>
              <span class="link-badge">${escapeHtml(item.status)}</span>
              <span class="link-badge link-badge-soft">${item.redirectStatusCode}</span>
            </div>
            <div class="link-card__meta">
              <a href="${escapeHtml(`${getBaseUrl(config)}/${item.slug}`)}" target="_blank" rel="noreferrer">${escapeHtml(`${getBaseUrl(config)}/${item.slug}`)}</a>
              <span>•</span>
              <span>${escapeHtml(item.destinationUrl)}</span>
            </div>
            <div class="muted link-card__submeta">${escapeHtml(item.id)}</div>
          </div>
          <div class="link-card__updated muted">
            ${escapeHtml(formatDisplayDate(stats?.link.lastClickedAt ?? item.lastClickedAt))}
          </div>
        </div>

        <div class="link-card__stats">
          ${statsSummaryHtml}
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
        </div>

        <details class="link-card__edit">
          <summary>Edit</summary>
          <form method="post" action="/admin/links/${item.id}" class="edit-form">
            <input type="hidden" name="_method" value="patch" />
            <div class="grid">
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
              <label class="field--full">Expiry
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
            </div>
            <button type="submit">Save</button>
          </form>
        </details>
      </article>
      `;
    }).join('');

    const html = `<!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Link Shortener Admin</title>
        <style>
          :root {
            color-scheme: light;
            --bg: #f3eee5;
            --bg-soft: #efe7db;
            --panel: rgba(255, 255, 255, 0.82);
            --panel-strong: #ffffff;
            --panel-border: rgba(89, 76, 58, 0.12);
            --text: #26201b;
            --muted: #7c7266;
            --accent: #3b82f6;
            --accent-strong: #2563eb;
            --accent-soft: rgba(59, 130, 246, 0.12);
            --shadow: 0 20px 60px rgba(78, 64, 47, 0.12);
            --shadow-soft: 0 10px 30px rgba(78, 64, 47, 0.08);
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: var(--text);
            background:
              radial-gradient(circle at top left, rgba(255, 255, 255, 0.75), transparent 38%),
              radial-gradient(circle at top right, rgba(188, 210, 255, 0.42), transparent 26%),
              linear-gradient(180deg, #f7f1e8 0%, var(--bg) 45%, #f0e8dc 100%);
          }
          body::before {
            content: "";
            position: fixed;
            inset: 0;
            pointer-events: none;
            background-image:
              linear-gradient(rgba(69, 54, 36, 0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(69, 54, 36, 0.02) 1px, transparent 1px);
            background-size: 28px 28px;
            mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.7), transparent 80%);
          }
          main {
            max-width: 1360px;
            margin: 0 auto;
            padding: 28px 20px 64px;
            position: relative;
            z-index: 1;
          }
          h1, h2, h3, p { margin: 0; }
          a { color: var(--accent-strong); text-decoration: none; }
          a:hover { text-decoration: underline; }
          .hero {
            display: flex;
            align-items: end;
            justify-content: space-between;
            gap: 24px;
            padding: 26px 28px;
            margin-bottom: 20px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.68));
            border: 1px solid var(--panel-border);
            border-radius: 28px;
            box-shadow: var(--shadow);
            backdrop-filter: blur(14px);
          }
          .hero-copy { max-width: 760px; display: grid; gap: 10px; }
          .eyebrow {
            text-transform: uppercase;
            letter-spacing: .18em;
            font-size: 11px;
            color: var(--muted);
          }
          .hero h1 {
            font-size: clamp(2.1rem, 4vw, 3.4rem);
            line-height: 0.98;
            letter-spacing: -0.05em;
          }
          .hero-copy p:last-child {
            color: var(--muted);
            font-size: 15px;
            line-height: 1.5;
            max-width: 62ch;
          }
          .hero-meta {
            display: grid;
            gap: 10px;
            min-width: 260px;
          }
          .hero-chip {
            background: rgba(255, 255, 255, 0.75);
            border: 1px solid var(--panel-border);
            border-radius: 18px;
            padding: 14px 16px;
            box-shadow: var(--shadow-soft);
            display: grid;
            gap: 4px;
          }
          .hero-chip span {
            text-transform: uppercase;
            letter-spacing: .16em;
            font-size: 10px;
            color: var(--muted);
          }
          .hero-chip strong {
            color: var(--text);
            font-size: 14px;
            line-height: 1.3;
            word-break: break-word;
          }
          .hero-chip.subtle {
            background: rgba(59, 130, 246, 0.08);
          }
          .dashboard-grid {
            display: grid;
            grid-template-columns: minmax(310px, 390px) minmax(0, 1fr);
            gap: 20px;
            align-items: start;
          }
          .panel {
            background: var(--panel);
            border: 1px solid var(--panel-border);
            border-radius: 24px;
            padding: 22px;
            box-shadow: var(--shadow-soft);
            backdrop-filter: blur(12px);
          }
          .panel h2 {
            font-size: 18px;
            letter-spacing: -0.03em;
            margin-bottom: 14px;
          }
          .panel-compact { position: sticky; top: 20px; }
          form { display: grid; gap: 14px; }
          .grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }
          .field--full {
            grid-column: 1 / -1;
          }
          label {
            display: grid;
            gap: 8px;
            font-size: 13px;
            color: var(--muted);
            font-weight: 600;
          }
          input, select {
            width: 100%;
            background: rgba(255, 255, 255, 0.8);
            color: var(--text);
            border: 1px solid rgba(89, 76, 58, 0.14);
            border-radius: 14px;
            padding: 12px 14px;
            font: inherit;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
          }
          input::placeholder { color: #a29688; }
          input:focus, select:focus, button:focus, summary:focus {
            outline: 3px solid rgba(59, 130, 246, 0.18);
            outline-offset: 2px;
          }
          button {
            background: linear-gradient(180deg, #60a5fa, var(--accent-strong));
            color: #fff;
            border: 0;
            border-radius: 14px;
            padding: 12px 16px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 14px 24px rgba(37, 99, 235, 0.24);
            transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
          }
          button:hover {
            transform: translateY(-1px);
            filter: saturate(1.05);
            box-shadow: 0 18px 30px rgba(37, 99, 235, 0.28);
          }
          .panel-table { min-width: 0; }
          .link-list {
            display: grid;
            gap: 14px;
          }
          .link-card {
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(246, 240, 231, 0.9));
            border: 1px solid rgba(89, 76, 58, 0.12);
            border-radius: 22px;
            padding: 18px;
            box-shadow: var(--shadow-soft);
            display: grid;
            gap: 18px;
          }
          .link-card__top {
            display: flex;
            justify-content: space-between;
            gap: 20px;
            align-items: flex-start;
          }
          .link-card__identity {
            min-width: 0;
            display: grid;
            gap: 10px;
          }
          .link-card__slug-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
          }
          .link-card__slug-row strong {
            font-size: 18px;
            letter-spacing: -0.03em;
          }
          .link-badge {
            display: inline-flex;
            align-items: center;
            border-radius: 999px;
            padding: 5px 10px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .08em;
            background: rgba(59, 130, 246, 0.12);
            color: var(--accent-strong);
          }
          .link-badge-soft {
            background: rgba(89, 76, 58, 0.08);
            color: var(--muted);
          }
          .link-card__meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            color: var(--muted);
            font-size: 14px;
            word-break: break-word;
          }
          .link-card__meta a {
            font-weight: 700;
          }
          .link-card__submeta {
            font-size: 12px;
          }
          .link-card__updated {
            font-size: 13px;
            text-align: right;
            white-space: nowrap;
          }
          .link-card__stats {
            display: grid;
            gap: 12px;
          }
          .link-card__edit {
            background: rgba(255, 255, 255, 0.55);
            border: 1px solid rgba(89, 76, 58, 0.08);
            border-radius: 18px;
            padding: 14px;
          }
          .link-card__edit summary {
            margin-bottom: 0;
          }
          .link-card__edit[open] summary {
            margin-bottom: 12px;
          }
          .inline-form { display: flex; gap: 8px; align-items: center; }
          .inline-form select, .inline-form button { padding: 8px 10px; }
          details {
            max-width: 100%;
          }
          summary {
            cursor: pointer;
            color: var(--accent-strong);
            font-weight: 700;
            margin-bottom: 10px;
            list-style: none;
          }
          summary::-webkit-details-marker { display: none; }
          .edit-form {
            margin-top: 10px;
            display: grid;
            gap: 10px;
          }
          .muted { color: var(--muted); }
          .stats-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
            gap: 10px;
          }
          .stats-summary-empty { opacity: 0.9; }
          .stats-metric {
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(249, 244, 235, 0.9));
            border: 1px solid rgba(89, 76, 58, 0.12);
            border-radius: 16px;
            padding: 10px 12px;
            display: grid;
            gap: 4px;
          }
          .stats-metric span {
            color: var(--muted);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: .12em;
          }
          .stats-metric strong {
            color: var(--text);
            font-size: 13px;
            line-height: 1.2;
            word-break: break-word;
          }
          .stats-metric small {
            color: var(--muted);
            font-size: 11px;
          }
          .stats-note { margin-top: 10px; }
          .stats-details { margin-top: 4px; max-width: 100%; }
          .stats-details summary { margin-bottom: 12px; }
          .stats-panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
          .chart-panel, .referrer-panel {
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(245, 239, 229, 0.95));
            border: 1px solid rgba(89, 76, 58, 0.12);
            border-radius: 18px;
            padding: 12px;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
          }
          .chart-panel h3, .referrer-panel h3 {
            margin: 0 0 10px;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: .12em;
            color: var(--muted);
          }
          .chart-shell { display: grid; gap: 8px; }
          .chart-caption { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 12px; }
          .chart-svg { width: 100%; height: auto; overflow: visible; }
          .chart-axis { fill: var(--muted); font-size: 10px; }
          .chart-axis--dim { opacity: 0.45; }
          .chart-bar { fill: var(--accent); }
          .chart-bar-empty { fill: rgba(89, 76, 58, 0.12); }
          .referrer-list { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
          .referrer-list li { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
          .referrer-main { display: grid; gap: 2px; min-width: 0; }
          .referrer-list code { color: var(--text); font-size: 13px; }
          .referrer-list small { color: var(--muted); font-size: 11px; }
          .referrer-list strong { color: var(--accent-strong); }
          .footer-note {
            margin-top: 18px;
            color: var(--muted);
            font-size: 13px;
            text-align: center;
          }
          .empty-state {
            padding: 28px;
            text-align: center;
            color: var(--muted);
            background: rgba(255, 255, 255, 0.65);
            border: 1px dashed rgba(89, 76, 58, 0.18);
            border-radius: 18px;
          }
          @media (max-width: 900px) {
            .hero { flex-direction: column; align-items: stretch; }
            .dashboard-grid { grid-template-columns: 1fr; }
            .panel-compact { position: static; }
            .grid { grid-template-columns: 1fr; }
            .field--full { grid-column: 1 / -1; }
            .link-card__top { flex-direction: column; }
            .link-card__updated { text-align: left; white-space: normal; }
          }
          @media (max-width: 640px) {
            main { padding-inline: 14px; }
            .hero, .panel { padding: 18px; border-radius: 20px; }
            .hero h1 { font-size: 2rem; }
          }
        </style>
      </head>
      <body>
        <main>
          <header class="hero">
            <div class="hero-copy">
              <p class="eyebrow">Control room</p>
              <h1>Link Shortener Admin</h1>
              <p>Manage redirects, inspect click patterns by day and hour, and keep an eye on referrers from a cleaner, calmer dashboard.</p>
            </div>
            <div class="hero-meta">
              <div class="hero-chip">
                <span>Base URL</span>
                <strong>${escapeHtml(getBaseUrl(config))}</strong>
              </div>
              <div class="hero-chip subtle">
                <span>Access</span>
                <strong>Admin token required</strong>
              </div>
            </div>
          </header>

          <div class="dashboard-grid">
            <section class="panel panel-compact">
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
                  <label class="field--full">Expiry
                    <input type="datetime-local" name="expiresAt" />
                  </label>
                </div>
                <label>Description
                  <input name="description" placeholder="Optional notes" />
                </label>
                <button type="submit">Create link</button>
              </form>
            </section>

            <section class="panel panel-table">
              <h2>Existing links</h2>
              <div class="link-list">${cards || '<div class="empty-state">No links yet.</div>'}</div>
            </section>
          </div>

          <p class="footer-note">Stats are shown in UTC to keep the distribution honest across time zones.</p>
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
  const paddingBottom = 34;
  const paddingLeft = 10;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const barWidth = plotWidth / Math.max(points.length, 1);
  const maxLabels = Math.max(4, Math.floor(width / 60));
  const labelStep = Math.max(1, Math.ceil(points.length / maxLabels));

  const bars = points.map((point, index) => {
    const barHeight = point.count === 0 ? 0 : Math.max(4, (point.count / maxValue) * plotHeight);
    const x = paddingLeft + (index * barWidth) + 2;
    const y = paddingTop + plotHeight - barHeight;
    const labelX = x + (barWidth - 4) / 2;
    const showLabel = index === 0 || index === points.length - 1 || index % labelStep === 0;
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
