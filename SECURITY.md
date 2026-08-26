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

### Authentication secrets

The admin dashboard uses session authentication with Argon2id password hashes, signed cookies, and CSRF protection. Treat `SESSION_SECRET` and administrator passwords as high-privilege secrets:

- Generate a random `SESSION_SECRET` of at least 32 characters.
- Never commit `.env` or `.env.production`.
- Rotate administrator credentials immediately if you suspect leakage.
- `ADMIN_TOKEN` is a deprecated compatibility fallback for the JSON API only. Do not enable it on new installations.

### Docker Compose defaults

`docker-compose.yml` ships with development-only PostgreSQL credentials so the stack can boot locally. These are **not safe for production**:

- Replace the Postgres credentials with strong, unique values and inject them via environment variables or a secrets manager.
- Do not publish the Postgres port (`5432`) on a publicly reachable interface in production.
- Behind the app, place an HTTPS-terminating reverse proxy so `SHORTENER_SCHEME=https` matches the public URL.
- For a single-server deployment, use `compose.production.yml`, which keeps PostgreSQL internal and exposes only Caddy on ports 80/443.

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

The dependency lockfile is audited before a public release. At the time of this update, the remaining findings are:

### `geoip-country` / `ip-address` (high, runtime)

- `geoip-country` depends on an affected `ip-address` release.
- The application only uses the country lookup API and does not call the vulnerable HTML-emitting methods or use the result for SSRF decisions.
- npm's suggested downgrade to `geoip-country@3.1.11` introduces multiple high-severity advisories from abandoned transitive packages, so it is not a safe remediation.
- This remains tracked until the upstream package updates or the GeoIP provider is replaced.

### `@esbuild-kit/*`, `drizzle-kit`, `esbuild` (moderate, development only)

- **Advisory:** [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — esbuild dev-server request smuggling.
- **Affected path:** transitive dependencies of `drizzle-kit` (devDependency) via the deprecated `@esbuild-kit/core-utils` and `@esbuild-kit/esm-loader` packages.
- **Exposure:** development tooling only (`drizzle-kit push`, `drizzle-kit generate`, and the `tsx` loader). These packages are never loaded by the production runtime or by the test runner.
- **Status:** npm proposes a breaking downgrade of `drizzle-kit`; the vulnerable development server is not exposed by this project. Tracked.
