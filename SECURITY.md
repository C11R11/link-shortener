# Security Policy

## Reporting a Vulnerability

Please report security issues privately via GitHub Security Advisories or by emailing the maintainer. Do not open public issues for security bugs.

## Known npm Audit Findings

`npm audit` currently reports 5 vulnerabilities (4 moderate, 1 high).

### Drizzle ORM (high, runtime)

- **Advisory:** GHSA-gpj5-g38j-94v9 — SQL injection via improperly escaped SQL identifiers.
- **Affected range:** `drizzle-orm <0.45.2`.
- **Current version:** `^0.43.1`.
- **Fix:** upgrade to `drizzle-orm@0.45.2`, which is a breaking change. This is intentionally deferred until the codebase is migrated to the new identifier-escaping API.

### `@esbuild-kit/*`, `drizzle-kit`, `esbuild` (moderate, dev-only)

- **Advisories:** GHSA-67mh-4wv8-2f99 (esbuild dev-server request smuggling).
- **Affected path:** transitive dependencies of `drizzle-kit` (devDependency) via the deprecated `@esbuild-kit/core-utils` and `@esbuild-kit/esm-loader` packages.
- **Exposure:** development tooling only (`drizzle-kit push`, `drizzle-kit generate`, and `tsx` loader). These packages are never loaded by the production runtime or test runner.
- **Fix:** upgrade to a `drizzle-kit` release that no longer depends on `@esbuild-kit/*`. That release is a breaking change. Tracked.

### Status

- `npm audit fix` (non-breaking) resolves nothing; all available fixes require a breaking change in `drizzle-orm` or `drizzle-kit`.
- Production runtime is not exposed to the dev-only chain. The Drizzle ORM SQL-injection finding is the only runtime-relevant issue and is tracked for the next breaking-change window.
