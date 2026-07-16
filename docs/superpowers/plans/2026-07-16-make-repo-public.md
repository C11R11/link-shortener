# Make Repository Public — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the link-shortener repository for public release by auditing security, fixing vulnerabilities, improving documentation, and adding basic CI.

**Architecture:** The project remains a Fastify + TypeScript + Drizzle + PostgreSQL link shortener. The public release does not change runtime behavior; it hardens configuration, documents setup, and adds automation.

**Tech Stack:** Node.js 22, Fastify 5, TypeScript 5.9, Drizzle ORM, PostgreSQL, Docker Compose, GitHub Actions.

**License:** MIT.

---

## Project Context

- Entry: `src/server.ts` creates app via `createApp(config, links)` from `src/app.ts`.
- Config is loaded from environment variables by `src/config.ts` (Zod schema).
- Auth: `ADMIN_TOKEN` via `Authorization: Bearer <token>` or `Basic` password.
- Existing security measures: Helmet, rate limiting (`@fastify/rate-limit`), admin auth on dashboard routes.
- Docker Compose mounts PostgreSQL data in a named volume and exposes ports 3000/5432.
- Existing docs: `docs/architecture.md`, `docs/memory.md`, `docs/superpowers/specs/`, `docs/superpowers/plans/`, `docs/superpowers/guides/`.

---

## Task 1: Audit for Secrets and Sensitive Data

**Files:**
- Read: `.env.example`, `docker-compose.yml`, `src/config.ts`, all files under `src/` and root.
- Modify: `.env.example`, `docker-compose.yml` if needed.

- [ ] **Step 1: Search for secrets in source**

```bash
grep -R -E "(password|secret|token|key|api_key|private)" src/ --include="*.ts" -n
grep -R -E "(postgres://|DATABASE_URL|ADMIN_TOKEN)" . --include="*.ts" --include="*.yml" --include="*.yaml" --include="*.json" --include="*.md" -n
```

Expected: no hardcoded credentials except in `.env.example` (placeholder values) and `docker-compose.yml` (dev-only local defaults).

- [ ] **Step 2: Verify .env.example uses placeholders**

Ensure `.env.example` values look like:

```
APP_PORT=3000
SHORTENER_DOMAIN=go.example.com
SHORTENER_SCHEME=https
DATABASE_URL=postgres://user:password@localhost:5432/dbname
ADMIN_TOKEN=change-me
REDIRECT_STATUS_CODE=302
```

If `DATABASE_URL` or `ADMIN_TOKEN` look realistic, replace with `change-me` or `REPLACE_ME`.

- [ ] **Step 3: Verify docker-compose uses dev-only defaults**

`docker-compose.yml` currently uses:

```yaml
DATABASE_URL: postgres://shortener:shortener@db:5432/shortener
ADMIN_TOKEN: ${ADMIN_TOKEN:-change-me}
```

This is acceptable for local dev. Add a comment warning not to use in production:

```yaml
# Dev-only credentials. Use environment variables or a secrets manager in production.
```

- [ ] **Step 4: Run git-secrets style check**

```bash
git log --all --full-history -- .env .env.local docker-compose.override.yml 2>/dev/null || echo "No sensitive history found"
git log -p --all -S "postgres://" | head -50
```

Expected: no commits with real database URLs or tokens.

- [ ] **Step 5: Commit**

```bash
git add .env.example docker-compose.yml
git commit -m "chore: clarify dev-only credentials and placeholders"
```

---

## Task 2: Run npm Audit and Fix Vulnerabilities

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Run audit**

```bash
npm audit
```

Capture output. The current baseline shows 5 vulnerabilities (4 moderate, 1 high). We need to see which are fixable and which are transitive/dev-only.

- [ ] **Step 2: Run audit fix for non-breaking fixes**

```bash
npm audit fix
```

Expected: some vulnerabilities resolved. If `npm run check` and `npm test` still pass, keep the changes.

- [ ] **Step 3: Document remaining vulnerabilities**

If vulnerabilities remain because they are transitive (e.g., via `@esbuild-kit` packages deprecated by `tsx`), add a `SECURITY.md` note or README section explaining they are dev-only and tracked.

- [ ] **Step 4: Verify tests and type-check**

```bash
npm run check
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: run npm audit fix"
```

---

## Task 3: Add License File

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create MIT LICENSE**

Use current year and the repository owner's name:

```
MIT License

Copyright (c) 2026 Pablo Fredrikson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Verify**

```bash
ls -la LICENSE
```

- [ ] **Step 3: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

## Task 4: Rewrite README for Public Use

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README**

```bash
cat README.md
```

- [ ] **Step 2: Write public-facing README**

Sections to include:

1. **Title + one-line description**
2. **Features** (short links, analytics dashboard, admin API)
3. **Tech stack**
4. **Quick start** (clone, copy `.env.example`, docker compose up, migrate, seed)
5. **Environment variables** table
6. **Admin dashboard** (URL, auth token)
7. **API endpoints** (shorten, redirect, stats)
8. **Development** (npm scripts)
9. **Deployment notes** (do not use docker-compose defaults in prod, run migrations, do not run seed in prod)
10. **Contributing** link
11. **License** link

- [ ] **Step 3: Verify markdown renders**

No broken links. Run:

```bash
npx markdownlint-cli2 README.md 2>/dev/null || echo "markdownlint not installed; skip"
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for public release"
```

---

## Task 5: Add CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create file**

Content:

```markdown
# Contributing

Thanks for your interest in contributing!

## Getting Started

1. Fork and clone the repository.
2. Copy `.env.example` to `.env` and fill in your values.
3. Run `docker compose up --build -d`.
4. Run `npm run migrate` and `npm run seed`.
5. Open `http://localhost:3000/admin/dashboard` with the admin token.

## Pull Request Process

1. Run `npm run check` and `npm test` before pushing.
2. Keep changes focused and well-scoped.
3. Update documentation if behavior changes.
4. Use clear commit messages.

## Code of Conduct

Be respectful and constructive.
```

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING guide"
```

---

## Task 6: Add SECURITY.md

**Files:**
- Create: `SECURITY.md`

- [ ] **Step 1: Create file**

Content:

```markdown
# Security Policy

## Supported Versions

Only the latest commit on `main` is supported with security updates.

## Reporting a Vulnerability

Please report security issues privately via GitHub Security Advisories or email the maintainer. Do not open public issues for security bugs.

## Current Known Considerations

- The admin dashboard uses a single `ADMIN_TOKEN`. Keep it secret and rotate it regularly.
- Docker Compose defaults are for local development only. Use strong credentials and a secrets manager in production.
- The `npm run seed` command deletes and re-creates dummy data. Never run it against a production database.
- CSP allows scripts from `unpkg.com` and `cdn.jsdelivr.net` for HTMX and Chart.js. If you vendor these libraries, update the CSP accordingly.
```

- [ ] **Step 2: Commit**

```bash
git add SECURITY.md
git commit -m "docs: add SECURITY policy"
```

---

## Task 7: Add GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: shortener_test
          POSTGRES_USER: shortener
          POSTGRES_PASSWORD: shortener
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm test
        env:
          DATABASE_URL: postgres://shortener:shortener@localhost:5432/shortener_test
          ADMIN_TOKEN: test-token
          SHORTENER_DOMAIN: localhost
          SHORTENER_SCHEME: http
          REDIRECT_STATUS_CODE: 302
```

- [ ] **Step 2: Verify workflow syntax**

```bash
npx yaml-lint .github/workflows/ci.yml 2>/dev/null || echo "yaml-lint not installed; visually inspect"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for tests and type-check"
```

---

## Task 8: Harden Security Checklist

**Files:**
- Read: `src/app.ts`, `src/config.ts`, `src/admin/dashboard.handlers.ts`
- Modify if needed.

- [ ] **Step 1: Verify no debug/error leakage**

Check that error handlers do not return stack traces or SQL details to clients in production. Fastify's default error handler may leak in dev. Verify `NODE_ENV` handling or add a custom error handler.

- [ ] **Step 2: Add production note about `NODE_ENV`**

In `README.md` or `SECURITY.md`, note that the app should run with `NODE_ENV=production` and that Fastify's logger level should be tuned.

- [ ] **Step 3: Verify dashboard auth is enforced**

Confirm all `/admin/dashboard*` routes call `requireAdmin(request)`. Already fixed in previous work; re-verify.

- [ ] **Step 4: Commit any security fixes**

```bash
git add ...
git commit -m "fix: [security fix description]"
```

---

## Task 9: Final Verification and Cleanup

- [ ] **Step 1: Full test suite**

```bash
npm run check
npm test
```

Expected: PASS.

- [ ] **Step 2: Docker smoke test**

```bash
docker compose down -v
docker compose up --build -d
npm run migrate
npm run seed
curl -H "Authorization: Bearer change-me" http://localhost:3000/admin/dashboard
```

Expected: 200 and HTML body.

- [ ] **Step 3: Git status clean**

```bash
git status --short
```

Expected: only untracked `.superpowers/` (ignored after this work if not already).

- [ ] **Step 4: Add `.superpowers/` to `.gitignore` if missing**

```bash
if ! grep -q ".superpowers/" .gitignore; then echo "" >> .gitignore && echo ".superpowers/" >> .gitignore; fi
git add .gitignore
git commit -m "chore: ignore .superpowers directory" || echo "already ignored"
```

- [ ] **Step 5: Final commit summary**

```bash
git log --oneline -20
```

---

## Self-Review Checklist

- [ ] No hardcoded secrets in source.
- [ ] `.env.example` uses placeholders.
- [ ] `docker-compose.yml` has dev-only defaults with warnings.
- [ ] `LICENSE` is MIT.
- [ ] `README.md` is public-facing and complete.
- [ ] `CONTRIBUTING.md` exists.
- [ ] `SECURITY.md` exists.
- [ ] GitHub Actions CI runs type-check and tests.
- [ ] npm audit is at minimum severity or documented.
- [ ] `.superpowers/` is in `.gitignore`.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-07-16-make-repo-public.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach do you want?
