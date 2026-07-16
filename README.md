# Link Shortener

A self-hosted link shortener with an admin dashboard and click analytics, built to replace Bitly on a domain you control.

## Features

- Short, branded URLs on a domain you own.
- Fast redirects with configurable HTTP status codes (301, 302, 307, 308).
- Admin dashboard with create/edit/disable flow and per-link analytics (total clicks, last 7 days, hourly buckets, top referrers, recent clicks).
- JSON API for programmatic link management.
- Per-link expiration, status (`active`, `disabled`, `archived`), title, description, and ownership metadata.
- Built-in security middleware: Helmet with CSP, global rate limiting, and admin bearer auth.
- Privacy-friendly click capture: only a hashed client IP is stored.

## Tech Stack

- **Runtime:** Node.js 22 + TypeScript 5
- **Framework:** [Fastify](https://fastify.dev/) 5
- **Database:** PostgreSQL 16 with [Drizzle ORM](https://orm.drizzle.team/)
- **Frontend (dashboard):** HTMX + Chart.js (no build step)
- **Tooling:** `tsx` for dev/runtime, `drizzle-kit` for migrations, `node:test` for tests

## Quick Start

```bash
git clone https://github.com/<your-org>/link-shortener.git
cd link-shortener
cp .env.example .env
# Edit .env and set ADMIN_TOKEN, DATABASE_URL, SHORTENER_DOMAIN at minimum.
docker compose up --build -d
npm run migrate
npm run seed   # optional: only for local development
```

> **Note for local development without Docker:** `docker compose` injects
> the required environment variables into every container automatically,
> so commands run inside Docker (e.g. `docker compose run --rm app npm run
> migrate`) pick them up without extra setup. Bare `npm run` scripts invoked
> on the host — such as `npm run migrate`, `npm run seed`, `npm test`, or
> `npm run dev` — read from the current shell instead, so make sure you
> have a local `.env` first:
>
> ```bash
> cp .env.example .env
> # edit .env with your values
> ```
>
> Without it, the app will refuse to start (Zod fails fast on a missing
> `DATABASE_URL` / `ADMIN_TOKEN` / `SHORTENER_DOMAIN`).

Open the dashboard at `http://localhost:3000/admin/dashboard` and authenticate with `Authorization: Bearer <ADMIN_TOKEN>`.

## Environment Variables

All variables are loaded through a Zod schema in `src/config.ts`. The app fails fast at startup if any required value is missing or invalid.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `APP_PORT` | No | `3000` | Port the Fastify server listens on. |
| `SHORTENER_DOMAIN` | Yes | — | Hostname used to build short URLs (e.g. `go.example.com`). |
| `SHORTENER_SCHEME` | No | `https` | `http` or `https`. `http` disables CSP for local development. |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string. |
| `ADMIN_TOKEN` | Yes | — | Bearer token for dashboard and write endpoints. Use a long random secret. |
| `REDIRECT_STATUS_CODE` | No | `302` | Default redirect status code when a link does not override it. Must be 301, 302, 307, or 308. |

## Admin Dashboard

- **URL:** `GET /admin/dashboard`
- **Auth:** send `Authorization: Bearer <ADMIN_TOKEN>` (or `Basic base64(:<ADMIN_TOKEN>)`).
- **Features:** create links, edit slug/destination/redirect code/title/description/expires, disable or archive links, view click charts and referrer breakdowns.

The dashboard is served as static HTML from `src/admin/` and progressively enhanced with HTMX.

## API Endpoints

All write endpoints and stats require the `Authorization: Bearer <ADMIN_TOKEN>` header.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/healthz` | No | Health probe; returns `{ ok, service, baseUrl }`. |
| `GET` | `/api/links` | No | List all links (read-only summary). |
| `POST` | `/api/links` | Yes | Create a link. Body: `{ slug, destinationUrl, redirectStatusCode?, title?, description?, createdBy?, expiresAt? }`. |
| `GET` | `/api/links/:id` | Yes | Fetch a single link by id. |
| `PATCH` | `/api/links/:id` | Yes | Update any link field, including `status`. |
| `DELETE` | `/api/links/:id` | Yes | Disable a link (soft-delete via `status = 'disabled'`). |
| `GET` | `/api/links/:id/stats` | Yes | Click stats: totals, 7-day series, hourly buckets, top referrers, recent clicks. |
| `GET` | `/:slug` | No | Public redirect. Records a click (with hashed IP) and returns the configured redirect status code. |

HTML form endpoints mirror the JSON API for the dashboard:

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/admin/links` | Yes | Create a link from the dashboard form. |
| `POST` | `/admin/links/:id` | Yes | Update a link (supports `_method` override). |

## Development

```bash
npm run dev        # watch mode via tsx
npm run check      # tsc --noEmit
npm test           # node:test suite (uses tsx loader)
npm run migrate    # apply Drizzle migrations to DATABASE_URL
npm run seed       # populate demo links (LOCAL ONLY — wipes seed slugs)
npm run db:generate # generate a new migration from schema changes
npm run db:push    # push schema directly (development only)
```

The test suite is `node:test` with `tsx` as the loader. Integration tests live in `test/`.

## Deployment Notes

- **Never deploy the docker-compose defaults.** Replace `DATABASE_URL`, `ADMIN_TOKEN`, and PostgreSQL credentials with values from a secrets manager.
- **Run migrations explicitly.** The Docker image starts the app but does not auto-migrate; run `npm run migrate` from a one-off task before/after deploy.
- **Do not run `npm run seed` in production.** The seed script wipes existing seed slugs and inserts demo data.
- **Set `SHORTENER_SCHEME=https`** in production so Helmet enables the strict CSP.
- **Run with `NODE_ENV=production`** to disable Fastify's development error details.
- **Front the app with HTTPS** (Caddy, Nginx, or a CDN) so the redirect URL matches `SHORTENER_SCHEME`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, pull request process, and code of conduct notes.

## Security

See [SECURITY.md](SECURITY.md) for supported versions, how to report vulnerabilities, and current known considerations.

## Documentation

- [Architecture](docs/architecture.md)
- [Project memory](docs/memory.md)
- [Roadmap](docs/roadmap.md)
- [Decision log](docs/decisions/0001-stack.md)

## License

[MIT](LICENSE)
