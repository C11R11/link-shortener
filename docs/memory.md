# Project Memory

This file is the living memory for the shortener project.

## Current product idea

Replace Bitly with a branded domain and a small self-hosted redirect service.

## Decisions made so far

- Start with a simple, single-service architecture.
- Keep redirects fast and boring.
- Document all major decisions in-repo.
- Use Postgres as the system of record.
- Keep analytics lightweight first, heavier later.
- Run everything in Docker from the start.
- Set the public domain through environment variables.
- Apply database migrations on container startup instead of bootstrapping schema in app code.
- Expose a basic admin dashboard and allow per-link redirect status code selection at create/edit time.

## Why this exists

- Control over the domain.
- Better ownership of links and analytics.
- Less dependency on third-party shortener pricing or outages.

## Notes from the first planning pass

- The redirect path should not depend on the admin UI.
- Admin and analytics can evolve separately.
- We should not overbuild on day one.
