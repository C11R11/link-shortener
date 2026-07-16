# Kimchi.dev Dashboard Theme — Replication Guide

This guide documents the visual system and implementation patterns used for the `/admin/dashboard` redesign so another Kimchi agent can replicate the same look and feel in a different repository.

## Overview

The theme is a **dark, terminal-inspired developer console** inspired by [kimchi.dev](https://kimchi.dev). It uses:

- Monospace typography
- Near-black backgrounds with subtle panel borders
- Green/orange/blue accents
- CLI-style labels (`$ stats --summary`, `$ clicks --time-series`)
- Server-side rendered HTML with progressive HTMX interactivity
- Chart.js for line charts

## Visual Style

### Color Palette

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
```

### Typography

- Font: `ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", monospace`
- KPI labels: `11px`, uppercase, letter-spacing `0.05em`
- KPI values: `24px`
- Section titles: `14px`, CLI-style (`$ command --flag`)

## Files to Create

For a new project, create these files:

| File | Purpose |
|---|---|
| `src/admin/dashboard.styles.css` | Theme CSS variables + component classes |
| `src/admin/dashboard.components.ts` | Pure functions that render HTML strings |
| `src/admin/dashboard.handlers.ts` | Fastify handlers for `/admin/dashboard*` routes |
| `src/admin/dashboard.handlers.test.ts` | Integration tests |
| `src/lib/stats.ts` | Global stats aggregation (if needed) |
| `src/scripts/seed.ts` | Dummy data generator for local testing |

## Core Components

### Layout Shell

```html
<!doctype html>
<html lang="es" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dashboard</title>
    <link rel="stylesheet" href="/admin/dashboard.styles.css" />
    <script src="https://unpkg.com/htmx.org@1.9.12"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
  </head>
  <body class="dash">
    ${content}
    <script>${clientScripts()}</script>
  </body>
</html>
```

### Header

```html
<header class="dash__header">
  <div>
    <h1 class="dash__title">$ dashboard --live</h1>
    <p class="dash__subtitle">baseUrl · admin/dashboard · <span style="color:var(--dash-success)">● main</span></p>
  </div>
  <div class="dash__toolbar">
    <span id="last-updated" class="dash__subtitle">Updated: just now</span>
    <button class="dash__btn" data-dash-action="refresh">↻ refresh</button>
    <button class="dash__btn" data-dash-action="theme">🌙</button>
  </div>
</header>
```

### KPI Section

```html
<section class="dash__section">
  <div class="dash__section-header"><h2 class="dash__section-title">$ stats --summary</h2></div>
  <div class="dash__section-body">
    <div class="dash__kpi-grid">
      <div class="dash__kpi">
        <div class="dash__kpi-label">Total Clicks</div>
        <div class="dash__kpi-value">12,438</div>
      </div>
      <!-- ... -->
    </div>
  </div>
</section>
```

### Chart Section

```html
<section class="dash__section" id="chart-section" data-chart='["2026-07-10",...]' data-values='[39,33,...]'>
  <div class="dash__section-header">
    <h2 class="dash__section-title">$ clicks --time-series</h2>
    <div class="dash__toolbar">
      <button class="dash__btn dash__btn--active" hx-get="/admin/dashboard/stats?period=7d" hx-target="#stats-container" hx-swap="outerHTML">7d</button>
      <!-- ... -->
    </div>
  </div>
  <div class="dash__section-body">
    <div class="dash__chart"><canvas id="clicks-chart"></canvas></div>
  </div>
</section>
```

## Client Scripts

Required behaviors:

1. **Theme toggle**: persist to `localStorage`, toggle `data-theme` on `<html>`, update button icon.
2. **Refresh button**: reload page.
3. **Chart init**: find `#clicks-chart` and `.detail-chart` canvases, parse `data-chart`/`data-values`, create Chart.js line charts.
4. **HTMX afterSettle**: re-run chart init after HTMX swaps to avoid stale/blank charts.
5. **Destroy old charts**: before creating a new Chart.js instance on a canvas, destroy any existing chart to prevent ghosts.

```ts
function initDashboard() {
  // theme logic
  // refresh logic
  // chart init with destroy-on-reinit
  document.body.addEventListener('htmx:afterSettle', initAllCharts);
}
```

## CSP Configuration

If using Helmet or similar CSP, allow:

```
script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net;
style-src 'self' 'unsafe-inline';
connect-src 'self' https://cdn.jsdelivr.net;
img-src 'self' data: https:;
```

## HTMX Patterns

### Stats Container

Wrap KPIs + chart in a single container so filters update everything atomically:

```html
<div id="stats-container">
  ${kpiSection}
  ${chartSection}
</div>
```

Buttons target `#stats-container` with `hx-swap="outerHTML"`.

**Avoid `hx-trigger="load"` on the container itself** — it creates an infinite request loop when the fragment is swapped back in.

### Cache Control

Return `Cache-Control: no-store` on HTMX fragment endpoints to prevent stale fragment caching.

## Dependency Installation

```bash
npm install @fastify/static
```

Serve static files (CSS) from `src/admin/` under `/admin/`:

```ts
await app.register(fastifyStatic, {
  root: path.join(__dirname, '../admin'),
  prefix: '/admin/',
});
```

## Seed Data for Local Testing

Create a `src/scripts/seed.ts` that:

1. Connects to the database.
2. Inserts dummy links.
3. Generates random clicks across the last 30 days.
4. Updates `clickCount` on each link.

Make it idempotent (delete existing seed data by slug before inserting).

## Adaptation Notes

- **Other frameworks**: the theme works with any server-side renderer. Keep the HTML structure and CSS classes; replace the template syntax.
- **Light mode**: define `[data-theme="light"]` variables and add a toggle button.
- **Charts without Chart.js**: the data attributes (`data-chart`, `data-values`) can also feed an SVG renderer if CDN dependencies are unacceptable.
- **Non-admin pages**: the same CSS variables and components can be reused; only the route handlers and data layer change.

## Checklist When Replicating

- [ ] CSS variables render correctly in dark mode.
- [ ] Theme toggle persists across reloads.
- [ ] HTMX fragment endpoints return `Cache-Control: no-store`.
- [ ] No `hx-trigger="load"` is placed on a fragment that gets swapped back into itself.
- [ ] Chart.js canvases are re-initialized on `htmx:afterSettle`.
- [ ] Old Chart.js instances are destroyed before creating new ones.
- [ ] CSP allows required CDNs and inline scripts.
