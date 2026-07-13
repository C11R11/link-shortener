# Decision 0001 - Initial stack

## Status

Accepted

## Context

We need a shortener that is simple enough to ship quickly, but structured enough to grow into a real service.

## Decision

Use:

- TypeScript
- Node.js
- Fastify
- Postgres
- Drizzle

## Consequences

- Fast startup for the MVP.
- Clear API boundaries.
- Easy schema evolution.
- Room to split redirect and admin later if needed.

