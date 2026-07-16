# Admin Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/admin/dashboard` as a Kimchi.dev-inspired, metrics-first UI with HTMX interactivity, Chart.js charts, dark/light theme toggle, global KPIs, and expandable per-link detail.

**Architecture:** Keep Fastify server-side rendering. Extract dashboard code from `src/app.ts` into a focused `src/admin/` module. Reuse existing `LinkService` for data. Add a thin `StatsService` for global aggregation. Serve HTMX and Chart.js from CDNs. Return HTML fragments from new `/admin/dashboard/*` HX endpoints.

**Tech Stack:** Fastify 5, TypeScript 5.9, Drizzle ORM, HTMX (CDN), Chart.js (CDN), CSS custom properties, Node native test runner.

---

## Project Context

- Entry: `src/server.ts` creates app via `createApp(config, links)` from `src/app.ts`.
- `LinkService` is built by `createLinkService(config)` in `src/lib/links.ts`.
- Existing stats endpoint: `links.getLinkStats(id)` returns `{ link, totalClicks, clicksLast7Days, clicksByDay[], clicksByHour[], topReferrers[], recentClicks[] }`.
- Auth helper `isAuthorized(request)` checks `Authorization: Bearer ADMIN_TOKEN` or `Basic ...`.
- Tests use `node --test --import tsx` and should import from `.js` paths.
- Package scripts: `npm test`, `npm run check` (tsc), `npm run dev`.

---

## Task 1: Create Global Stats Service

**Files:**
- Create: `src/lib/stats.ts`
- Test: `src/lib/stats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/lib/stats.test.ts
```

Expected: FAIL with `Cannot find module` or `createStatsService is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/lib/stats.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "feat(stats): add global stats service"
```

---

## Task 2: Create Theme CSS

**Files:**
- Create: `src/admin/dashboard.styles.css`

- [ ] **Step 1: Create the CSS file**

```css
:root {
  color-scheme: dark;
  --dash-bg: #0a0a0a;
  --dash-bg-soft: #111111;
  --dash-panel: #111111;
  --dash-panel-hover: #1a1a1a;
  --dash-border: #222222;
  --dash-text: #e5e5e5;
  --dash-text-muted: #888888;
  --dash-text-strong: #ffffff;
  --dash-accent: #3b82f6;
  --dash-accent-strong: #60a5fa;
  --dash-success: #22c55e;
  --dash-warning: #f97316;
  --dash-danger: #ef4444;
  --dash-font: ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", monospace;
}

[data-theme="light"] {
  color-scheme: light;
  --dash-bg: #f3eee5;
  --dash-bg-soft: #efe7db;
  --dash-panel: rgba(255, 255, 255, 0.82);
  --dash-panel-hover: #ffffff;
  --dash-border: rgba(89, 76, 58, 0.12);
  --dash-text: #26201b;
  --dash-text-muted: #7c7266;
  --dash-text-strong: #26201b;
  --dash-accent: #2563eb;
  --dash-accent-strong: #3b82f6;
  --dash-success: #16a34a;
  --dash-warning: #ea580c;
  --dash-danger: #dc2626;
}

.dash { font-family: var(--dash-font); background: var(--dash-bg); color: var(--dash-text); min-height: 100vh; }
.dash__container { max-width: 1360px; margin: 0 auto; padding: 24px; }
.dash__header { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--dash-border); margin-bottom: 24px; }
.dash__title { font-size: 20px; color: var(--dash-text-strong); margin: 0; }
.dash__subtitle { font-size: 12px; color: var(--dash-text-muted); margin: 4px 0 0; }
.dash__toolbar { display: flex; gap: 8px; align-items: center; }
.dash__btn { background: transparent; border: 1px solid var(--dash-border); color: var(--dash-text); padding: 6px 10px; border-radius: 4px; cursor: pointer; font: inherit; }
.dash__btn:hover { background: var(--dash-panel-hover); }
.dash__btn--active { border-color: var(--dash-success); color: var(--dash-success); }
.dash__kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
.dash__kpi { border: 1px solid var(--dash-border); border-radius: 6px; padding: 16px; background: var(--dash-panel); }
.dash__kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--dash-text-muted); }
.dash__kpi-value { font-size: 24px; color: var(--dash-text-strong); margin-top: 4px; }
.dash__kpi-delta { font-size: 12px; margin-top: 4px; }
.dash__section { border: 1px solid var(--dash-border); border-radius: 6px; background: var(--dash-panel); margin-bottom: 24px; overflow: hidden; }
.dash__section-header { padding: 12px 16px; border-bottom: 1px solid var(--dash-border); display: flex; justify-content: space-between; align-items: center; }
.dash__section-title { font-size: 14px; color: var(--dash-text-strong); margin: 0; }
.dash__section-body { padding: 16px; }
.dash__chart { height: 220px; }
.dash__table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dash__table th, .dash__table td { padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--dash-border); }
.dash__table th { color: var(--dash-text-muted); font-weight: normal; }
.dash__table tr:hover { background: var(--dash-panel-hover); cursor: pointer; }
.dash__table tr[aria-expanded="true"] { background: var(--dash-panel-hover); }
.dash__link { color: var(--dash-accent-strong); text-decoration: none; }
.dash__badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
.dash__badge--active { color: var(--dash-success); }
.dash__badge--archived { color: var(--dash-warning); }
.dash__badge--disabled { color: var(--dash-text-muted); }
.dash__form { display: grid; gap: 12px; }
.dash__form-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.dash__input { background: var(--dash-bg); border: 1px solid var(--dash-border); color: var(--dash-text); padding: 8px 10px; border-radius: 4px; font: inherit; width: 100%; }
.dash__detail { padding: 16px; border-top: 1px solid var(--dash-border); background: var(--dash-bg-soft); }
.dash__detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.dash__detail-chart { height: 140px; }
@media (max-width: 900px) { .dash__kpi-grid { grid-template-columns: repeat(2, 1fr); } .dash__form-row { grid-template-columns: 1fr 1fr; } .dash__detail-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .dash__kpi-grid { grid-template-columns: 1fr; } .dash__form-row { grid-template-columns: 1fr; } }
```

- [ ] **Step 2: Verify no syntax issues**

```bash
npm run check
```

Expected: PASS (CSS files are ignored by tsc, but ensures no TS side effects).

- [ ] **Step 3: Commit**

```bash
git add src/admin/dashboard.styles.css
git commit -m "feat(admin): add dashboard theme css"
```

---

## Task 3: Create Dashboard HTML Components

**Files:**
- Create: `src/admin/dashboard.components.ts`

- [ ] **Step 1: Create helper functions**

```ts
import { getBaseUrl, type AppConfig } from '../config.js';
import type { LinkRecord, LinkStats } from '../app.js';
import type { GlobalStats, StatsPeriod } from '../lib/stats.js';

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function layoutShell(config: AppConfig, content: string): string {
  return `<!doctype html>
<html lang="es" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Link Shortener Admin</title>
    <link rel="stylesheet" href="/admin/dashboard.styles.css" />
    <script src="https://unpkg.com/htmx.org@1.9.12"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
  </head>
  <body class="dash">
    ${content}
    <script>${dashboardClientScripts()}</script>
  </body>
</html>`;
}

export function renderHeader(config: AppConfig): string {
  const baseUrl = escapeHtml(getBaseUrl(config));
  return `<header class="dash__header">
    <div>
      <h1 class="dash__title">$ dashboard --live</h1>
      <p class="dash__subtitle">${baseUrl} · admin/dashboard · <span style="color:var(--dash-success)">● main</span></p>
    </div>
    <div class="dash__toolbar">
      <span id="last-updated" class="dash__subtitle">Updated: just now</span>
      <button class="dash__btn" data-dash-action="refresh">↻ refresh</button>
      <button class="dash__btn" data-dash-action="theme">🌙</button>
    </div>
  </header>`;
}

export function renderKpiSection(stats: GlobalStats): string {
  return `<section class="dash__section">
    <div class="dash__section-header"><h2 class="dash__section-title">$ stats --summary</h2></div>
    <div class="dash__section-body">
      <div class="dash__kpi-grid">
        ${renderKpi('Total Clicks', stats.totalClicks.toLocaleString())}
        ${renderKpi('Active Links', stats.activeLinks.toLocaleString())}
        ${renderKpi('Clicks / Day', stats.clicksPerDay.toLocaleString())}
        ${renderKpi('Top Referrer', stats.topReferrer)}
      </div>
    </div>
  </section>`;
}

function renderKpi(label: string, value: string): string {
  return `<div class="dash__kpi">
    <div class="dash__kpi-label">${escapeHtml(label)}</div>
    <div class="dash__kpi-value">${escapeHtml(value)}</div>
  </div>`;
}

export function renderChartSection(period: StatsPeriod): string {
  return `<section class="dash__section" id="chart-section" hx-get="/admin/dashboard/stats?period=${period}" hx-trigger="load" hx-target="this" hx-swap="outerHTML">
    <div class="dash__section-header">
      <h2 class="dash__section-title">$ clicks --time-series</h2>
      <div class="dash__toolbar">
        ${['24h', '7d', '30d'].map((p) => `<button class="dash__btn ${p === period ? 'dash__btn--active' : ''}" hx-get="/admin/dashboard/stats?period=${p}" hx-target="#chart-section" hx-swap="outerHTML">${p}</button>`).join('')}
      </div>
    </div>
    <div class="dash__section-body">
      <div class="dash__chart"><canvas id="clicks-chart"></canvas></div>
    </div>
  </section>`;
}

export function renderStatsFragment(stats: GlobalStats, period: StatsPeriod): string {
  return `${renderKpiSection(stats)}${renderChartSection(period)}`;
}

export function renderCreateForm(): string {
  return `<section class="dash__section">
    <div class="dash__section-header"><h2 class="dash__section-title">$ link create</h2></div>
    <div class="dash__section-body">
      <form class="dash__form" method="post" action="/admin/links">
        <div class="dash__form-row">
          <input class="dash__input" name="slug" placeholder="slug" required />
          <input class="dash__input" name="destinationUrl" placeholder="https://..." required />
          <select class="dash__input" name="redirectStatusCode"><option>301</option><option>302</option><option>307</option><option>308</option></select>
          <button type="submit" class="dash__btn">create</button>
        </div>
      </form>
    </div>
  </section>`;
}

export function renderLinksTable(config: AppConfig, links: LinkRecord[], statsById: Map<string, LinkStats | null>): string {
  return `<section class="dash__section">
    <div class="dash__section-header"><h2 class="dash__section-title">$ ls links --sort=clicks</h2></div>
    <div class="dash__section-body" style="padding:0">
      <table class="dash__table">
        <thead><tr><th>slug</th><th>destination</th><th>clicks</th><th>7d</th><th>status</th></tr></thead>
        <tbody>
          ${links.map((link) => renderLinkRow(config, link, statsById.get(link.id))).join('')}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderLinkRow(config: AppConfig, link: LinkRecord, stats: LinkStats | null | undefined): string {
  const badgeClass = link.status === 'active' ? 'dash__badge--active' : link.status === 'archived' ? 'dash__badge--archived' : 'dash__badge--disabled';
  return `<tr hx-get="/admin/dashboard/links/${link.id}/detail" hx-target="next .dash__detail" hx-swap="outerHTML" hx-trigger="click">
    <td><a class="dash__link" href="${escapeHtml(getBaseUrl(config) + '/' + link.slug)}" target="_blank" onclick="event.stopPropagation()">/${escapeHtml(link.slug)}</a></td>
    <td>${escapeHtml(link.destinationUrl)}</td>
    <td>${(stats?.totalClicks ?? 0).toLocaleString()}</td>
    <td>${(stats?.clicksLast7Days ?? 0).toLocaleString()}</td>
    <td><span class="dash__badge ${badgeClass}">● ${link.status}</span></td>
  </tr>
  <tr class="dash__detail" style="display:none"><td colspan="5"></td></tr>`;
}

export function renderLinkDetail(stats: LinkStats, config: AppConfig): string {
  return `<tr class="dash__detail">
    <td colspan="5">
      <div class="dash__detail-grid">
        <div>
          <h3 class="dash__section-title">$ clicks --by-day</h3>
          <div class="dash__detail-chart"><canvas class="detail-chart" data-type="day" data-labels='${JSON.stringify(stats.clicksByDay.map((d) => d.bucket))}' data-values='${JSON.stringify(stats.clicksByDay.map((d) => d.count))}'></canvas></div>
        </div>
        <div>
          <h3 class="dash__section-title">$ clicks --by-hour</h3>
          <div class="dash__detail-chart"><canvas class="detail-chart" data-type="hour" data-labels='${JSON.stringify(stats.clicksByHour.map((d) => d.bucket))}' data-values='${JSON.stringify(stats.clicksByHour.map((d) => d.count))}'></canvas></div>
        </div>
      </div>
      <div style="margin-top:16px">
        <h3 class="dash__section-title">$ referrers --top</h3>
        <table class="dash__table">
          <thead><tr><th>referrer</th><th>clicks</th></tr></thead>
          <tbody>${stats.topReferrers.map((r) => `<tr><td>${escapeHtml(r.referrer)}</td><td>${r.count}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div style="margin-top:16px">
        <h3 class="dash__section-title">$ recent-clicks --limit=10</h3>
        <table class="dash__table">
          <thead><tr><th>timestamp</th><th>referrer</th><th>country</th><th>user agent</th></tr></thead>
          <tbody>${stats.recentClicks.map((c) => `<tr><td>${c.clickedAt.toISOString()}</td><td>${escapeHtml(c.referrer ?? '-')}</td><td>${escapeHtml(c.country ?? '-')}</td><td>${escapeHtml(c.userAgent ?? '-')}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div style="margin-top:16px">
        <h3 class="dash__section-title">$ link edit ${stats.link.id}</h3>
        <form class="dash__form" method="post" action="/admin/links/${stats.link.id}">
          <input type="hidden" name="_method" value="patch" />
          <div class="dash__form-row">
            <input class="dash__input" name="slug" value="${escapeHtml(stats.link.slug)}" />
            <input class="dash__input" name="destinationUrl" value="${escapeHtml(stats.link.destinationUrl)}" />
            <select class="dash__input" name="redirectStatusCode">${[301, 302, 307, 308].map((c) => `<option ${c === stats.link.redirectStatusCode ? 'selected' : ''}>${c}</option>`).join('')}</select>
            <select class="dash__input" name="status">${['active', 'disabled', 'archived'].map((s) => `<option ${s === stats.link.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
          </div>
          <div class="dash__form-row">
            <input class="dash__input" name="title" value="${escapeHtml(stats.link.title ?? '')}" placeholder="title" />
            <input class="dash__input" name="description" value="${escapeHtml(stats.link.description ?? '')}" placeholder="description" />
            <input class="dash__input" type="datetime-local" name="expiresAt" value="${stats.link.expiresAt ? new Date(stats.link.expiresAt).toISOString().slice(0, 16) : ''}" />
            <button type="submit" class="dash__btn">save</button>
          </div>
        </form>
      </div>
    </td>
  </tr>`;
}
```

- [ ] **Step 2: Fix type issues**

Note: `getBaseUrl({} as never)` is a placeholder. Pass `config` through `renderLinksTable` and `renderLinkRow` properly. Update signatures as needed.

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/admin/dashboard.components.ts
git commit -m "feat(admin): add dashboard html components"
```

---

## Task 4: Create Client-Side Scripts

**Files:**
- Create: `src/admin/dashboard.scripts.ts`

- [ ] **Step 1: Create the script**

```ts
export function dashboardClientScripts(): string {
  return `(() => {
    const html = document.documentElement;
    const stored = localStorage.getItem('dashboard-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = stored || (prefersDark ? 'dark' : 'light');
    html.setAttribute('data-theme', theme);

    document.querySelectorAll('[data-dash-action="theme"]').forEach((btn) => {
      btn.textContent = theme === 'dark' ? '🌙' : '☀️';
      btn.addEventListener('click', () => {
        const current = html.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        localStorage.setItem('dashboard-theme', next);
        btn.textContent = next === 'dark' ? '🌙' : '☀️';
      });
    });

    document.querySelectorAll('[data-dash-action="refresh"]').forEach((btn) => {
      btn.addEventListener('click', () => window.location.reload());
    });

    function initChart(canvas, labels, values, label) {
      const Chart = (window as any).Chart;
      if (!canvas || !Chart) return;
      new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [{ label, data: values, borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.1)', fill: true, tension: 0.3 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#888' }, grid: { color: '#222' } }, y: { ticks: { color: '#888' }, grid: { color: '#222' }, beginAtZero: true } } }
      });
    }

    const mainChart = document.getElementById('clicks-chart');
    if (mainChart) {
      const section = mainChart.closest('.dash__section');
      const data = section?.dataset.chart ? JSON.parse(section.dataset.chart) : { labels: [], values: [] };
      initChart(mainChart, data.labels, data.values, 'Clicks');
    }

    document.querySelectorAll('.detail-chart').forEach((canvas) => {
      const labels = JSON.parse(canvas.dataset.labels || '[]');
      const values = JSON.parse(canvas.dataset.values || '[]');
      initChart(canvas, labels, values, canvas.dataset.type === 'day' ? 'By day' : 'By hour');
    });
  })();`;
}
```

- [ ] **Step 2: Verify tsc**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/admin/dashboard.scripts.ts
git commit -m "feat(admin): add dashboard client scripts"
```

---

## Task 5: Create Dashboard Handlers

**Files:**
- Create: `src/admin/dashboard.handlers.ts`
- Modify: `src/app.ts` (later)

- [ ] **Step 1: Create handler module**

```ts
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

export function registerDashboard(app: FastifyInstance, config: AppConfig, links: LinkService) {
  const statsService = createStatsService(links);

  app.get('/admin/dashboard', async (request, reply) => {
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
    const period = normalizePeriod((request.query as { period?: string }).period);
    const stats = await statsService.getGlobalStats(period);
    return reply.type('text/html').send(renderStatsFragment(stats, period));
  });

  app.get('/admin/dashboard/links/:id/detail', async (request, reply) => {
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
```

- [ ] **Step 2: Verify tsc**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/admin/dashboard.handlers.ts
git commit -m "feat(admin): add dashboard route handlers"
```

---

## Task 6: Wire Up Routes and Remove Inline Dashboard

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Register dashboard routes**

At the top of `src/app.ts` add:

```ts
import { registerDashboard } from './admin/dashboard.handlers.js';
```

Inside `createApp`, after `setup()` or after existing routes, add:

```ts
registerDashboard(app, config, links);
```

- [ ] **Step 2: Remove old inline `/admin/dashboard` handler**

Delete the entire `app.get('/admin/dashboard', async (request, reply) => { ... })` block and all helper functions only used by it (`renderStatsSummary`, `renderClickTimeline`, `renderReferrerList`, `renderEmptyStatsSummary`, `renderEmptyTimeline`, `renderEmptyReferrerList`, dashboard-specific CSS in `<style>`, etc.). Keep `escapeHtml` if used elsewhere; otherwise move it to components.

- [ ] **Step 3: Add static file route for CSS/JS**

Inside `setup()` or after it:

```ts
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await app.register(fastifyStatic, {
  root: path.join(__dirname, '../admin'),
  prefix: '/admin/',
  serveDotFiles: false,
});
```

Add dependency:

```bash
npm install @fastify/static
```

Note: only the CSS file is served statically. The JS is inlined by `layoutShell()` via `dashboardClientScripts()`.

- [ ] **Step 4: Verify server starts**

```bash
npm run check
npm run dev
```

Open `http://localhost:3000/admin/dashboard` (or configured port) and verify auth still works.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts package.json package-lock.json
git commit -m "feat(admin): wire up new dashboard and remove inline html"
```

---

## Task 7: Integration Tests

**Files:**
- Create: `src/admin/dashboard.handlers.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createApp } from '../app.js';
import type { LinkService, LinkRecord } from '../app.js';

const ADMIN_TOKEN = 'test-token';
const config = {
  SHORTENER_SCHEME: 'http',
  SHORTENER_HOST: 'localhost',
  SHORTENER_PORT: 3000,
  ADMIN_TOKEN,
  REDIRECT_STATUS_CODE: 302,
  DATABASE_URL: '',
} as const;

function makeLinkService(): LinkService {
  return {
    listLinks: async () => [],
    getLinkBySlug: async () => null,
    getLinkById: async () => null,
    createLink: async (input) => ({ id: '1', ...input, clickCount: 0, lastClickedAt: null, status: 'active', createdAt: new Date(), updatedAt: new Date() }) as LinkRecord,
    updateLink: async () => null,
    disableLink: async () => null,
    recordClick: async () => {},
    getLinkStats: async () => null,
  };
}

describe('dashboard handlers', () => {
  it('returns 401 without admin token', async () => {
    const app = createApp(config, makeLinkService());
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard' });
    assert.equal(res.statusCode, 401);
  });

  it('renders dashboard html with admin token', async () => {
    const app = createApp(config, makeLinkService());
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard', headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.includes('text/html'));
    assert.ok(res.body.includes('dashboard --live'));
  });

  it('returns stats fragment', async () => {
    const app = createApp(config, makeLinkService());
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard/stats?period=7d', headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('stats --summary'));
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- src/admin/dashboard.handlers.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/admin/dashboard.handlers.test.ts
git commit -m "test(admin): add dashboard handler integration tests"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run type check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 3: Smoke test locally**

```bash
npm run dev
```

Verify:
- Dark theme loads by default.
- KPIs render.
- 24h/7d/30d buttons swap chart fragment via HTMX.
- Clicking a table row expands detail with charts.
- Theme toggle switches light/dark.
- Create/edit forms work.

- [ ] **Step 4: Commit final fixes**

```bash
git add .
git commit -m "chore(admin): final dashboard polish"
```

---

## Self-Review Checklist

- [ ] Spec coverage: every design decision (HTMX, Chart.js, theme toggle, global KPIs, expandable rows, inline forms) maps to a task.
- [ ] No placeholders: each step contains code or exact commands.
- [ ] Type consistency: `LinkService`, `LinkStats`, `GlobalStats`, `StatsPeriod` used consistently.
- [ ] Existing tests preserved: only remove old inline dashboard code, keep link API tests.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-07-16-admin-dashboard-redesign.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach do you want?
