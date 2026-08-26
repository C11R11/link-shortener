# Contributing

Thanks for your interest in contributing to the link shortener.

## Getting Started

1. Fork and clone the repository.
2. Install Node.js 22 and Docker.
3. Copy `.env.example` to `.env` and fill in your values. At minimum set `SESSION_SECRET`, `DATABASE_URL`, and `SHORTENER_DOMAIN`.
4. Start the stack:

   ```bash
   docker compose up --build -d
   ```

5. The app container applies migrations when it starts. Create the first admin and optionally seed demo data:

   ```bash
   docker compose exec app npm run create-admin -- \
     --email=admin@example.com \
     --password='choose-a-strong-password'
   docker compose exec app npm run seed   # local development only
   ```

6. Open `http://localhost:3000/admin/login` and sign in with the admin credentials.

## Development Workflow

- Run `npm run dev` for the watch-mode server.
- Keep changes focused and well-scoped; prefer multiple small commits over one large one.
- Match the existing TypeScript and module style (ESM, single quotes, no unused locals).
- Update or add tests for any behavior change. The test suite is `node:test` driven via `tsx`.
- Update documentation (`README.md`, `docs/architecture.md`, `docs/memory.md`, or relevant guides) when behavior changes.

## Pull Request Process

1. Make sure `npm run check` and `npm test` both pass locally before pushing.
2. Write clear, descriptive commit messages.
3. Reference any related issues in the PR description.
4. Ensure CI is green on your branch.
5. Be responsive to review feedback and willing to iterate.

## Code of Conduct

Be respectful, constructive, and welcoming. Harassment or abusive behavior of any kind is not tolerated. If you witness or experience unacceptable behavior, contact the maintainer through the channels listed in [SECURITY.md](SECURITY.md).

## Reporting Security Issues

Please do not file public issues for security bugs. Follow the disclosure process in [SECURITY.md](SECURITY.md) instead.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
