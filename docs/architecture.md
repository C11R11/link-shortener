# Architecture

## Goal

Build a self-hosted link shortener to replace Bitly, using a short branded domain and keeping control of routing, analytics, and lifespan of each link.

## Non-goals for MVP

- No public user signup.
- No multi-tenant product.
- No advanced marketing automation.
- No QR campaign builder in the first cut.

## Principles

- Redirect path must be boring and fast.
- Admin complexity should stay separate from redirect latency.
- Every important decision must be documented in this repo.
- Prefer simple components that can be replaced later.

## Proposed stack

- Runtime: TypeScript on Node.js.
- Web framework: Fastify.
- Database: Postgres.
- ORM: Drizzle.
- Cache: optional Redis later if redirect traffic needs it.
- Hosting: single service at first, then split redirect and admin only if necessary.

## High-level flow

1. User hits `go.example.com/abc123`.
2. Edge or app receives the request.
3. Service looks up `abc123`.
4. If link exists and is active, service records the click asynchronously or best-effort.
5. Service returns a redirect to the destination URL.

## Components

### Redirect service

- Handles public short URLs.
- Returns 302/307 by default.
- Must be the fastest path in the system.

### Admin API

- Creates and edits links.
- Enables or disables links.
- Exposes link stats.

### Admin UI

- Minimal internal interface for creating links and reviewing stats.
- Can be introduced after the API is stable.
- Should let the operator choose the redirect status code per link.
- The first version can be a server-rendered dashboard protected by admin auth.

### Data store

- Stores link definitions.
- Stores click events or rollups.
- Stores audit metadata.

## Suggested data model

### `links`

- `id`
- `slug`
- `destination_url`
- `redirect_status_code`
- `title`
- `description`
- `status`
- `created_at`
- `updated_at`
- `created_by`
- `expires_at`
- `deleted_at`

### `link_clicks`

- `id`
- `link_id`
- `clicked_at`
- `referrer`
- `user_agent`
- `country`
- `ip_hash`

### Optional later tables

- `domains`
- `campaigns`
- `link_tags`
- `users`
- `api_tokens`

## API surface

### Public

- `GET /:slug` -> redirect.

### Admin

- `GET /admin/dashboard`
- `POST /api/links`
- `GET /api/links`
- `GET /api/links/:id`
- `PATCH /api/links/:id`
- `DELETE /api/links/:id`
- `GET /api/links/:id/stats`

## Analytics strategy

Start with simple click recording and daily aggregates.

Phase 1:
- total clicks
- clicks per day
- top referrers
- last click timestamp

Phase 2:
- country and device breakdown
- campaign attribution
- import/export for reporting

## Security

- Admin endpoints require auth.
- Short link creation must be rate limited.
- Destination URLs should be validated.
- Dangerous schemes like `javascript:` must be rejected.
- Click logging should avoid storing raw IPs if not needed.

## Observability

- Structured logs.
- Request latency.
- Redirect success and failure counters.
- Admin audit trail.
- Alert if redirect lookup starts failing.

## Deployment shape

Initial shape:
- one app
- one database
- one domain

Later shape if traffic or complexity grows:
- dedicated redirect edge
- separate admin app
- dedicated analytics pipeline

## Open questions

- Do we want the short domain to be public or internal only?
- Do we need Bitly import from day one?
- Should we store raw click events forever or roll them up?
- Do we want per-link custom slugs to be editable after creation?
