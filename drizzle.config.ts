import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://shortener:shortener@db:5432/shortener';

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});

