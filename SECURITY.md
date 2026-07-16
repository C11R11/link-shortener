# Security Policy

## Supported Versions

Only the latest commit on the `main` branch receives security updates. Older releases are not maintained; if you need a fix, please upgrade to `main` or build from the latest tag.

## Reporting a Vulnerability

Please report security issues privately. **Do not open public GitHub issues for security bugs.**

Preferred channels:

- GitHub Security Advisories: use the "Report a vulnerability" button on the repository's Security tab.
- Email: contact the maintainer directly (see the GitHub profile for the current address).

When reporting, please include:

- A clear description of the issue and its impact.
- Reproduction steps or a proof-of-concept.
- The commit SHA or release tag you tested against.
- Any suggested remediation, if you have one.

You can expect an acknowledgement within a reasonable time frame, followed by a coordinated disclosure once a fix is ready.

## Current Known Considerations

### Admin token

The admin dashboard and write API are gated by a single `ADMIN_TOKEN` (sent as `Authorization: Bearer <token>` or `Basic <base64(:token)>`). Treat this value as a high-privilege secret:

- Use a long, randomly generated token (e.g. `openssl rand -hex 32`).
- Never commit the token. `.env.example` ships with `change-me` as a placeholder only.
- Rotate the token periodically and immediately if you suspect leakage.
- In production, source it from a secrets manager rather than a plain `.env` file.

### Docker Compose defaults

`docker-compose.yml` ships with development-only credentials (`shortener` / `shortener` for Postgres, `ADMIN_TOKEN=change-me` for the app) so the stack can boot out of the box. These are **not safe for production**:

- Replace the Postgres credentials with strong, unique values and inject them via environment variables or a secrets manager.
- Always set `ADMIN_TOKEN` to a long random value before exposing the service.
- Do not publish the Postgres port (`5432`) on a publicly reachable interface in production.
- Behind the app, place an HTTPS-terminating reverse proxy so `SHORTENER_SCHEME=https` matches the public URL.

### Seed command

`npm run seed` is intended strictly for local development. It wipes the slugs used by the seed fixture and inserts demo links. **Never run it against a production database** — it does not confirm the environment and will overwrite data.

### Content Security Policy and CDN dependencies

When the app runs over HTTPS, the strict CSP allows scripts from `https://unpkg.com` and `https://cdn.jsdelivr.net` (HTMX and Chart.js are loaded from these CDNs by the dashboard). Be aware of the implications:

- A compromise of those CDNs could allow script injection into the dashboard. Pin to specific versions with Subresource Integrity (SRI) if your threat model requires it.
- If you self-host the dashboard assets, remove these origins from the CSP in `src/app.ts` and update `src/admin/` accordingly.
- `script-src` includes `'unsafe-inline'` to support small inline bootstrap snippets in the dashboard HTML; review and tighten if you do not need them.

### Stack notes

- Helmet is enabled (with CSP when `SHORTENER_SCHEME=https`).
- Global rate limiting is configured at 120 requests per minute per IP via `@fastify/rate-limit`.
- Click events store only a SHA-256 hash of the client IP, never the raw IP.

## Known npm Audit Findings

`npm audit` currently reports 5 vulnerabilities (4 moderate, 1 high).

### Drizzle ORM (high, runtime)

- **Advisory:** [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9) — SQL injection via improperly escaped SQL identifiers.
- **Affected range:** `drizzle-orm < 0.45.2`.
- **Pinned version:** `^0.43.1`.
- **Status:** the fix is a breaking change (the identifier-escaping API changed in 0.45.x). The upgrade is tracked and deferred until the codebase is migrated to the new API. Until then, callers must continue to avoid passing untrusted strings as SQL identifiers (table/column names); the application does not do this today.

### `@esbuild-kit/*`, `drizzle-kit`, `esbuild` (moderate, dev-only)

- **Advisory:** [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — esbuild dev-server request smuggling.
- **Affected path:** transitive dependencies of `drizzle-kit` (devDependency) via the deprecated `@esbuild-kit/core-utils` and `@esbuild-kit/esm-loader` packages.
- **Exposure:** development tooling only (`drizzle-kit push`, `drizzle-kit generate`, and the `tsx` loader). These packages are never loaded by the production runtime or by the test runner.
- **Status:** the fix requires upgrading `drizzle-kit` to a release that drops `@esbuild-kit/*`, which is a breaking change. Tracked.

`npm audit fix` (non-breaking) resolves nothing today; both findings require a breaking upgrade in the dependency chain. The Drizzle ORM SQL-injection finding is the only runtime-relevant issue and is tracked for the next breaking-change window.
