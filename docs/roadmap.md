# Roadmap

## Phase 0 - Foundation

- Define stack and architecture.
- Create repo structure.
- Add database schema.
- Add local dev environment.

## Phase 1 - Core product

- Create short links.
- Resolve short links to redirects.
- Basic admin auth.
- Basic stats.
- Basic admin dashboard for create/edit flows.
- Redirect test coverage for 301/302/307/308 and failure states.

## Phase 2 - Polishing

- Custom slugs.
- Expiration and disable switch.
- Link notes and tags.
- Better reporting: click history charts by day and hour, plus referrer breakdown.
- Per-link redirect status code control.

## Phase 3 - Hardening

- Rate limiting.
- Abuse prevention.
- Observability and alerts.
- Backup and restore flow.
- Replace the shared `ADMIN_TOKEN` / HTTP Basic fallback with robust admin authentication:
  - Session-based login with secure, `HttpOnly`, `SameSite` cookies and CSRF protection.
  - Password hashing with Argon2id, login throttling, lockout/backoff, and session revocation.
  - Support multiple admin users and credential rotation without downtime.
  - Evaluate optional OIDC/OAuth login and passkeys (WebAuthn), keeping self-hosting practical.
  - Provide a documented migration path from the existing `ADMIN_TOKEN`.

## Phase 4 - Production deployment guides

- Add an end-to-end HostGator VPS installation guide covering:
  - VPS provisioning through Pablo's HostGator referral link, clearly disclosed as an affiliate link.
  - DNS, firewall, SSH hardening, Docker/Compose installation, and non-root deployment.
  - Production secrets, PostgreSQL persistence, migrations, and backup/restore verification.
  - HTTPS and reverse-proxy setup with Caddy or Nginx.
  - Service startup after reboot, health checks, logs, upgrades, and rollback.
  - A final smoke test for redirects, dashboard authentication, and TLS renewal.
