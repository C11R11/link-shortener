# Decision - Admin authentication

## Status

Accepted (replaces the `ADMIN_TOKEN`-only model from earlier releases)

## Context

The link shortener originally shipped with a single shared `ADMIN_TOKEN` used as a Bearer (or Basic) credential for every admin-facing route, both JSON (`/api/*`) and HTML (`/admin/*`). That model has several weaknesses that the Phase 3 hardening track in `docs/roadmap.md` calls out:

- A single shared secret is impossible to attribute, rotate without downtime, or revoke for a single operator.
- It cannot be combined with per-user audit trails.
- It requires every admin client (dashboard, CI scripts, automation) to share the same secret, multiplying blast radius if any one leaks.
- There is no way to do password rotation without restarting the service, and no way to expire sessions independently of the token.

The shortener is a self-hosted project. Any new auth system needs to remain practical for a single operator deploying via `docker compose`, without forcing them to stand up additional infrastructure (an IdP, a Redis cluster, a KMS, etc.) just to shorten links.

## Decision

Replace `ADMIN_TOKEN` with **session-based admin authentication** built from small, well-understood primitives:

- **Sessions stored in Postgres.** A `users` table holds email, name, Argon2id password hash, role, and active flag. A `sessions` table holds `(userId, tokenHash, expiresAt)`. Sessions survive app restarts because authoritative state is in the database.
- **Signed cookies for the session token.** `@fastify/cookie` is registered once with `SESSION_SECRET`. The session cookie carries a 32-byte opaque token (base64url). The cookie is `HttpOnly`, `SameSite=Lax`, `signed`, and `Secure` when `SHORTENER_SCHEME=https`. Server-side we store only a SHA-256 hash of the token in `sessions.tokenHash`, so a database leak does not yield usable session cookies.
- **Argon2id via `hash-wasm`.** Passwords are hashed with Argon2id (memory 64 MiB, iterations 3, parallelism 4, 32-byte hash, 16-byte random salt) and the encoded PHC string is stored in `users.passwordHash`. `hash-wasm` is pure WebAssembly so it avoids the node-gyp native build step that the `argon2` npm package would require.
- **CSRF protection via a separate signed cookie.** Each `GET /admin/login` mints a random CSRF token, writes it to a short-lived (1 hour) signed cookie (`CSRF_COOKIE_NAME`), and renders it as a hidden input. POST handlers compare the submitted value to the unsigned cookie value. Combined with `SameSite=Lax` cookies this gives defense-in-depth against cross-site form submissions.
- **Login throttling in-memory, keyed by `${email}:${ip}`.** Failed attempts apply exponential backoff (starting at 1s, capped at 30 minutes). The bucket resets on a successful login. The throttle is single-instance only; multi-instance deployments would need Redis-backed counters.
- **Two reusable guards.** `requireAdminApi` accepts either a valid session or the legacy `ADMIN_TOKEN` (Bearer/Basic). `requireAdminHtml` accepts only a valid session and otherwise redirects to `/admin/login`. The dashboard never accepts the legacy token.
- **Bootstrap via CLI.** `npm run create-admin -- --email=... --password=... [--name=...]` and `npm run rotate-credentials -- --email=... --password=...` manage users out-of-band without restarting the service. `rotate-credentials` also revokes all existing sessions for that user.
- **`ADMIN_TOKEN` kept as an optional legacy fallback** for the JSON API only, so existing scripts and CI integrations keep working during migration.

## Consequences

Positive:

- Each admin has their own credentials; rotation is per-user and immediate; attribution is straightforward.
- Sessions can be revoked independently of password changes (`POST /admin/logout`, password rotation, deactivating `users.isActive`).
- Cookie is the only client-side state; nothing but a hash lives in the database, so a DB read-only compromise does not yield session forgery material.
- Argon2id via `hash-wasm` ships as a single WASM blob, no native build, no `node-gyp` toolchain required to install.
- The legacy `ADMIN_TOKEN` fallback avoids breaking existing `/api/*` consumers during cutover.

Negative / acknowledged trade-offs:

- Argon2id hashing is slower than bcrypt or a native argon2 binding. Login volume is low (admin only) so this is acceptable.
- Login throttling state lives in process memory. A second app instance behind a load balancer would have independent counters; this is documented as future Redis work, not a blocker for single-instance self-hosting.
- Password policy is intentionally minimal (length only). Operators are expected to choose strong passwords; the CLI does not enforce complexity rules beyond length.
- Origin/Referer checks are not implemented for the login form. `SameSite=Lax` plus the CSRF cookie token is the baseline; tightening this is tracked as future hardening.
- An `ADMIN_TOKEN` is still accepted by the JSON API when set. Leaving it set indefinitely is a configuration smell; the README recommends removing it after migration.

## Evaluation of alternatives

The roadmap asks us to explicitly compare built-in sessions against external auth and against newer credential models before picking one.

### OIDC / OAuth 2.0 (e.g. Authentik, Keycloak, Auth0, GitHub OAuth)

- **Operational complexity for self-hosters: high.** OIDC requires standing up and maintaining a separate identity provider, configuring clients, managing redirect URIs, and keeping the IdP patched and backed up. For a single-operator `docker compose` deployment this is a significant step up in surface area.
- **Infrastructure requirements: high.** An IdP service, its own database, TLS certificates for the IdP hostname, and outbound connectivity to any third-party provider. Either of those adds a dependency that the shortener should not impose on its users.
- **UX for solo admins: mixed.** "Sign in with Google" is convenient for individuals who already have an account, but it adds a per-deployment setup step and a dependency on an external service that may not be appropriate for an internal shortener.
- **Rationale for deferring.** OIDC is the right answer for multi-tenant or team deployments where SSO across several tools matters. It is the wrong answer for the smallest self-hosted single-operator case, which is the project's primary audience. We keep the option open by routing all admin authentication through a small `AuthService` interface so an OIDC adapter can be added later behind the same `requireAdminApi` / `requireAdminHtml` guards.

### WebAuthn (passkeys, hardware keys)

- **Operational complexity for self-hosters: medium.** WebAuthn itself is browser-native and needs no extra server-side infrastructure beyond storing credentials per user, but it adds meaningful code: registration ceremonies, assertion verification, multiple credentials per user, recovery flow for lost devices.
- **Infrastructure requirements: low.** No external service. Requires HTTPS in production (we already require it) and a browser that supports WebAuthn (all current evergreen browsers do).
- **UX: excellent for phishing resistance**, but the recovery story (lost YubiKey / laptop) is non-trivial. Every admin needs a fallback path, which usually loops back to "a password" or "another passkey".
- **Rationale for deferring.** WebAuthn is a strong future addition (especially as a second factor on top of passwords) and the `AuthService` interface is the right seam to add it. Shipping it in this iteration would have doubled the surface area of chunk 2-4 without changing the user-facing story for the majority of self-hosters, who do not yet own a hardware key. Passwords + CSRF + session cookies cover the realistic threat model today.

### JWT / stateless bearer tokens

- Considered and rejected. Stateless JWTs give up the ability to revoke individual sessions without rotating a signing key, and they invite the same shared-secret hygiene problems we are trying to escape. A signed-cookie session with a Postgres-backed registry keeps the operational story small and the revocation story simple.

### Keep `ADMIN_TOKEN` only

- Rejected. Fails the Phase 3 hardening goal and provides no per-user attribution, rotation, or revocation.

## Migration path

For existing deployments:

1. Provision a strong `SESSION_SECRET` (at least 32 random bytes, base64url-encoded). Generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
2. Apply migrations so the `users` and `sessions` tables exist.
3. Run `npm run create-admin -- --email=admin@example.com --password='...'` to bootstrap the first admin.
4. Log in to the dashboard once to verify the new flow end-to-end.
5. Remove `ADMIN_TOKEN` from the environment (`unset` it or delete it from `.env` / secrets manager / `docker-compose.yml`) and restart the service.

Until step 5, `Authorization: Bearer <ADMIN_TOKEN>` and `Authorization: Basic base64(:<ADMIN_TOKEN>)` continue to authenticate `/api/*` requests. The HTML dashboard (`/admin/*`) does not accept the legacy token under any circumstances; it always requires a session login. This split lets operators stage the rollout (new dashboard first, then wean API consumers off the legacy token) without downtime.

`npm run rotate-credentials` is the recommended way to rotate a password without restarting the service; it also revokes all existing sessions for that user, forcing a fresh login on every device.
