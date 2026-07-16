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

function renderChartSectionBase(period: StatsPeriod, hxLoad: boolean, chartData: Array<{ bucket: string; count: number }>): string {
  const loadTrigger = hxLoad ? ` hx-trigger="load" hx-get="/admin/dashboard/stats?period=${period}" hx-target="this" hx-swap="outerHTML"` : '';
  const labels = escapeHtml(JSON.stringify(chartData.map((d) => d.bucket)));
  const values = escapeHtml(JSON.stringify(chartData.map((d) => d.count)));
  return `<section class="dash__section" id="chart-section" data-chart='${labels}' data-values='${values}'${loadTrigger}>
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

export function renderChartSection(period: StatsPeriod, chartData: Array<{ bucket: string; count: number }>): string {
  return renderChartSectionBase(period, true, chartData);
}

export function renderChartSectionHx(period: StatsPeriod, chartData: Array<{ bucket: string; count: number }>): string {
  return renderChartSectionBase(period, false, chartData);
}

export function renderStatsFragment(stats: GlobalStats, period: StatsPeriod): string {
  return `${renderKpiSection(stats)}${renderChartSectionHx(period, stats.chartData)}`;
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
          <div class="dash__detail-chart"><canvas class="detail-chart" data-type="day" data-labels='${escapeHtml(JSON.stringify(stats.clicksByDay.map((d) => d.bucket)))}' data-values='${escapeHtml(JSON.stringify(stats.clicksByDay.map((d) => d.count)))}'></canvas></div>
        </div>
        <div>
          <h3 class="dash__section-title">$ clicks --by-hour</h3>
          <div class="dash__detail-chart"><canvas class="detail-chart" data-type="hour" data-labels='${escapeHtml(JSON.stringify(stats.clicksByHour.map((d) => d.bucket)))}' data-values='${escapeHtml(JSON.stringify(stats.clicksByHour.map((d) => d.count)))}'></canvas></div>
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

export function dashboardClientScripts(): string {
  return `(() => {
    function initDashboard() {
      const html = document.documentElement;
      const stored = localStorage.getItem('dashboard-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = stored || (prefersDark ? 'dark' : 'light');
      html.setAttribute('data-theme', theme);

      document.querySelectorAll('[data-dash-action="theme"]').forEach((btn) => {
        btn.textContent = theme === 'dark' ? '\u{1F319}' : '\u{2600}\u{FE0F}';
        btn.addEventListener('click', () => {
          const current = html.getAttribute('data-theme') || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          html.setAttribute('data-theme', next);
          localStorage.setItem('dashboard-theme', next);
          document.querySelectorAll('[data-dash-action="theme"]').forEach((b) => {
            b.textContent = next === 'dark' ? '\u{1F319}' : '\u{2600}\u{FE0F}';
          });
        });
      });

      document.querySelectorAll('[data-dash-action="refresh"]').forEach((btn) => {
        btn.addEventListener('click', () => window.location.reload());
      });

      function initChart(canvas, labels, values, label) {
        const Chart = window.Chart;
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
        const labels = section && section.dataset.chart ? JSON.parse(section.dataset.chart) : [];
        const values = section && section.dataset.values ? JSON.parse(section.dataset.values) : [];
        initChart(mainChart, labels, values, 'Clicks');
      }

      document.querySelectorAll('.detail-chart').forEach((canvas) => {
        const labels = JSON.parse(canvas.dataset.labels || '[]');
        const values = JSON.parse(canvas.dataset.values || '[]');
        initChart(canvas, labels, values, canvas.dataset.type === 'day' ? 'By day' : 'By hour');
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initDashboard);
    } else {
      initDashboard();
    }
  })();`;
}
