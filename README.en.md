# Link Shortener

[Leer en español](README.md)

A self-hosted link shortener with an admin dashboard and click analytics, built to replace Bitly on a domain you control.

## Features

- Short, branded URLs on a domain you own.
- Fast redirects with configurable HTTP status codes (301, 302, 307, 308).
- Admin dashboard with create/edit/disable flow and per-link analytics (total clicks, last 7 days, hourly buckets, top referrers, recent clicks).
- JSON API for programmatic link management.
- Per-link expiration, status (`active`, `disabled`, `archived`), title, description, and ownership metadata.
- Built-in security middleware: Helmet with CSP, global rate limiting, and session-based admin auth (Argon2id + signed cookies + CSRF).
- Privacy-friendly click capture: only a hashed client IP is stored.

## Tech Stack

- **Runtime:** Node.js 22 + TypeScript 5
- **Framework:** [Fastify](https://fastify.dev/) 5
- **Database:** PostgreSQL 16 with [Drizzle ORM](https://orm.drizzle.team/)
- **Frontend (dashboard):** HTMX + Chart.js (no build step)
- **Tooling:** `tsx` for dev/runtime, `drizzle-kit` for migrations, `node:test` for tests

## Quick Start

```bash
git clone https://github.com/pablokbs/link-shortener.git
cd link-shortener
cp .env.example .env
# Edit .env and set DATABASE_URL, SHORTENER_DOMAIN, and SESSION_SECRET at minimum.
docker compose up --build -d
docker compose exec app npm run create-admin -- \
  --email=admin@example.com \
  --password='choose-a-strong-password'
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
> `DATABASE_URL` / `SESSION_SECRET` / `SHORTENER_DOMAIN`).

Open the dashboard at `http://localhost:3000/admin/dashboard` and log in with the admin credentials you created above.

For a production deployment with Caddy and automatic Let's Encrypt certificates, follow the [HostGator VPS guide in the Spanish README](README.md#instalación-rápida-en-un-vps-de-hostgator).

## Environment Variables

All variables are loaded through a Zod schema in `src/config.ts`. The app fails fast at startup if any required value is missing or invalid.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `APP_PORT` | No | `3000` | Port the Fastify server listens on. |
| `SHORTENER_DOMAIN` | Yes | — | Hostname used to build short URLs (e.g. `go.example.com`). |
| `SHORTENER_SCHEME` | No | `https` | `http` or `https`. `http` disables CSP for local development. |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string. |
| `SESSION_SECRET` | Yes | — | Secret used to sign session and CSRF cookies. Must be at least 32 characters. Generate with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`. |
| `SESSION_MAX_AGE_SECONDS` | No | `604800` | Session lifetime in seconds (default 7 days). |
| `SESSION_COOKIE_NAME` | No | `link_shortener_session` | Name of the signed session cookie. |
| `CSRF_COOKIE_NAME` | No | `link_shortener_csrf` | Name of the signed CSRF cookie. |
| `ADMIN_TOKEN` | No | — | **Deprecated legacy fallback.** When set, still authenticates `/api/*` requests via `Authorization: Bearer <token>` (or Basic auth). The HTML dashboard requires a session login. See [Migrating from ADMIN_TOKEN](#migrating-from-admin_token). |
| `REDIRECT_STATUS_CODE` | No | `302` | Default redirect status code when a link does not override it. Must be 301, 302, 307, or 308. |

## Admin Dashboard

- **URL:** `GET /admin/dashboard`
- **Auth:** session-based login. Unauthenticated requests are redirected to `/admin/login`.
- **Features:** create links, edit slug/destination/redirect code/title/description/expires, disable or archive links, view click charts and referrer breakdowns, change your own password.

The dashboard is served as static HTML from `src/admin/` and progressively enhanced with HTMX. All POST forms include a CSRF token bound to a short-lived signed cookie.

### Creating the first admin

Before anyone can log in, create an admin user in the database:

```bash
npm run create-admin -- --email=admin@example.com --password='choose-a-strong-password' [--name='Admin']
```

The script is idempotent: if a user with that email already exists it exits 0 without changes. Passwords must be at least 8 characters; choose something long and random.

### Rotating credentials

To rotate an admin's password without restarting the service (and to invalidate all of their existing sessions):

```bash
npm run rotate-credentials -- --email=admin@example.com --password='new-strong-password'
```

Logged-in admins can also rotate their own password from the dashboard via **Change password**.

### Migrating from ADMIN_TOKEN

Older releases used a single shared `ADMIN_TOKEN` for everything. The new session-based system is the recommended way to authenticate, but `ADMIN_TOKEN` is still honored as a **fallback for the JSON API only** (`/api/*`). The HTML dashboard (`/admin/*`) requires a full session login regardless of `ADMIN_TOKEN`.

To migrate an existing deployment:

1. Provision a strong `SESSION_SECRET` (see the env table).
2. Create at least one admin user with `npm run create-admin`.
3. Log in to the dashboard once to verify the new flow works end-to-end.
4. Remove `ADMIN_TOKEN` from your environment (unset the variable or delete the line from `.env` / your secrets manager / `docker-compose.yml`) and restart the service.

Until you remove it, scripts and CI tokens that use `Authorization: Bearer <ADMIN_TOKEN>` will keep working against `/api/*` — handy for staged rollouts and emergency access, but not something to leave set long-term.

## API Endpoints

Write endpoints and stats accept either a session cookie (set by `POST /admin/login`) or, if `ADMIN_TOKEN` is configured, the legacy `Authorization: Bearer <ADMIN_TOKEN>` header (or `Basic base64(:<ADMIN_TOKEN>)`).

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

- **Never deploy the docker-compose defaults.** Replace `DATABASE_URL`, `SESSION_SECRET`, and PostgreSQL credentials with values from a secrets manager.
- **Migrations run when the app container starts.** Back up the database before deploying a release that contains schema changes.
- **Do not run `npm run seed` in production.** The seed script wipes existing seed slugs and inserts demo data.
- **Set `SHORTENER_SCHEME=https`** in production so Helmet enables the strict CSP.
- **Run with `NODE_ENV=production`** to disable Fastify's development error details.
- **Front the app with HTTPS** (Caddy, Nginx, or a CDN) so the redirect URL matches `SHORTENER_SCHEME`.
- Use `compose.production.yml` for a single-server deployment with internal PostgreSQL and Caddy-managed TLS. The default `docker-compose.yml` is for development only.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, pull request process, and code of conduct notes.

## Security

See [SECURITY.md](SECURITY.md) for supported versions, how to report vulnerabilities, and current known considerations.

## Documentation

- [Architecture](docs/architecture.md)
- [Project memory](docs/memory.md)
- [Roadmap](docs/roadmap.md)
- [Decision log](docs/decisions/0001-stack.md)
- [Auth ADR](docs/decisions/auth.md)

## License

[MIT](LICENSE)
