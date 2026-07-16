# Admin Dashboard Redesign — Design Spec

**Date:** 2026-07-16  
**Scope:** `/admin/dashboard` UI redesign for the link-shortener project.  
**Status:** Approved (pending implementation plan).

## 1. Overview

Redesign `/admin/dashboard` to be a technical, metrics-first interface inspired by [kimchi.dev](https://kimchi.dev). The new dashboard keeps the existing Fastify server-side architecture, adds progressive interactivity via HTMX + Chart.js, and introduces a dark/light theme toggle.

## 2. Goals

- Give the admin dashboard a technical, "developer console" aesthetic.
- Surface global metrics (all links) alongside per-link detail.
- Reduce full-page reloads for common actions (time-range filters, row expansion).
- Keep the implementation maintainable without turning the project into a SPA.

## 3. Non-goals

- No migration to React, Vue, or another frontend framework.
- No real-time WebSocket updates.
- No user-management or billing features.

## 4. Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Visual style | Kimchi.dev-inspired dark terminal | User-requested technical aesthetic. |
| Rendering | Server-side HTML templates | Matches existing stack; avoids SPA complexity. |
| Interactivity | HTMX from CDN | Enables partial updates without new build tooling. |
| Charts | Chart.js from CDN | Rich tooltips/animations; less custom SVG code. |
| Theme | Dark default + light toggle | Better accessibility while keeping default aesthetic. |
| Forms location | Inline in dashboard | User wants create/edit without leaving the page. |
| Link list | All links with scroll | Simplicity over pagination for current scale. |
| Per-link detail | Expandable row | Fast comparison; keeps everything on one page. |
| Refresh | Manual refresh button | Simplicity over polling; explicit control. |
| Metrics per link | All available stats | Clicks by day, clicks by hour, top referrers, recent clicks. |

## 5. User Interface

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ~/link-shortener  admin/dashboard  ● main    [refresh] [🌙] │
├─────────────────────────────────────────────────────────────┤
│  $ dashboard --live                                         │
│  Last updated: 2026-07-16 14:32:01 UTC                      │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │Total     │ │Active    │ │Clicks/   │ │Top       │        │
│  │Clicks    │ │Links     │ │Day       │ │Referrer  │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
├─────────────────────────────────────────────────────────────┤
│  $ clicks --time-series --days=14    [24h] [7d] [30d]       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                                                     │    │
│  │              [Chart.js line chart]                  │    │
│  │                                                     │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  $ link create                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  slug  destination  status  [create]                │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  $ ls links --sort=clicks                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ slug │ destination │ clicks │ 7d │ status │ ▼       │    │
│  ├──────┼─────────────┼────────┼────┼────────┼─────────┤    │
│  │ /x   │ ...         │ 4,231  │ +  │ active │         │    │
│  │      │ [expanded: charts + referrers + edit form]   │    │
│  │ /y   │ ...         │ 1,892  │ +  │ active │         │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Visual Style

- **Background:** `#0a0a0a` (dark), `#f3eee5` (light).
- **Cards/panels:** `#111` with 1px `#222` border (dark); cream panels (light).
- **Text:** `#e5e5e5` primary, `#888` muted, `#fff` emphasis (dark).
- **Accent:** `#22c55e` for positive/active, `#f97316` for warnings/archived, `#3b82f6` for links/actions.
- **Font:** `ui-monospace`, `SFMono-Regular`, `Menlo`, monospace.
- **Border radius:** 6px for cards, 4px for badges/buttons.

## 6. Architecture

### 6.1 New Files

| File | Responsibility |
|---|---|
| `src/admin/dashboard.ts` | Main `GET /admin/dashboard` handler. |
| `src/admin/dashboard.handlers.ts` | HTMX partial handlers (`/admin/dashboard/stats`, `/admin/dashboard/links/:id/detail`). |
| `src/admin/dashboard.styles.css` | Theme CSS variables and component styles. |
| `src/admin/dashboard.components.ts` | Pure functions to render KPI cards, tables, charts containers, forms. |
| `src/admin/dashboard.scripts.ts` | Client-side JS: theme toggle, Chart.js initialization. |
| `src/lib/stats.ts` | Global metrics aggregation queries. |
| `src/admin/dashboard.test.ts` | Integration tests for handlers and rendering. |

### 6.2 Existing Files to Modify

| File | Change |
|---|---|
| `src/app.ts` | Remove inline dashboard HTML; register new dashboard routes. |
| `src/lib/links.ts` | Add `getGlobalStats(period)` if it doesn't exist; reuse existing `getLinkStats`. |

### 6.3 Data Flow

1. `GET /admin/dashboard` returns full HTML shell with KPI placeholders and table.
2. On load, HTMX swaps in KPIs and chart data from `GET /admin/dashboard/stats?period=7d`.
3. User clicks 24h/7d/30d → HTMX request updates global KPIs and the time-series chart for that period.
4. User clicks a table row → HTMX request loads `links/:id/detail` into the expanded row, showing per-link charts, referrers, recent clicks, and an inline edit form.
5. Create/edit forms submit to existing `POST /admin/links` / `POST /admin/links/:id` and redirect to dashboard.

## 7. API / Endpoints

### Reused

- `GET /api/links/:id/stats`
- `POST /admin/links`
- `POST /admin/links/:id` (`_method=patch`)

### New (HX partials)

| Method | Route | Returns |
|---|---|---|
| GET | `/admin/dashboard/stats?period=24h\|7d\|30d` | KPI cards + chart container markup. |
| GET | `/admin/dashboard/links?sort=clicks&status=` | Partial table rows. |
| GET | `/admin/dashboard/links/:id/detail` | Expanded row detail markup. |

All HX endpoints require admin auth and return HTML fragments.

## 8. Theme Toggle

- Default theme: **dark**.
- Toggle button in header.
- Preference stored in `localStorage` under key `dashboard-theme`.
- Theme class applied to `<html>`; CSS variables switch via `[data-theme="light"]` selector.
- On first load, respect `prefers-color-scheme` if no stored preference exists.

## 9. Error Handling

- HX requests that fail show an inline toast/banner with the error message.
- Full dashboard render never depends on chart data; KPIs and chart load lazily.
- If Chart.js CDN fails, fall back to a text summary of the data.

## 10. Testing Strategy

- **Unit:** `getGlobalStats` aggregation logic.
- **Integration:** each new HX endpoint returns valid HTML and respects auth.
- **Snapshot:** full dashboard HTML structure (sensitive to major layout regressions).
- **Client:** theme toggle stores preference and updates class.
- **Race:** concurrent dashboard loads don't break stats (existing `Promise.all` behavior preserved).

## 11. Acceptance Criteria

- [ ] `/admin/dashboard` renders with dark theme by default and light theme toggles correctly.
- [ ] KPI cards and chart load after initial render without full reload.
- [ ] 24h / 7d / 30d filters update KPIs and chart via HTMX.
- [ ] Clicking a link row expands its detail section with 4 metric blocks.
- [ ] Create/edit link forms work inline and redirect back to dashboard.
- [ ] Dashboard layout is usable down to 640px width.
- [ ] Existing test suite still passes.

## 12. Out of Scope

- Real-time updates / WebSockets.
- User roles beyond admin.
- Bulk link operations.
- Data export (CSV/JSON).
- Link search/filter by text (can be added later).

## 13. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Chart.js CDN unavailable | Load from two CDNs or fallback to server-rendered SVG. |
| HTMX bundle increases page weight | Served from CDN with `defer`; only ~14 KB gzipped. |
| Refactoring monolithic `app.ts` | Extract in small, tested chunks; keep existing handlers intact during migration. |

## 14. References

- Existing dashboard handler: `src/app.ts` (~lines 130–480)
- Existing stats endpoint: `GET /api/links/:id/stats`
- Inspiration: [https://kimchi.dev](https://kimchi.dev)
