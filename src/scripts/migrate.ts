import fs from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { loadConfig } from '../config.js';

const config = loadConfig();

const client = postgres(config.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

const migrationsDir = path.resolve(process.cwd(), 'migrations');

async function ensureMigrationsTable() {
  await client`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function getAppliedMigrations() {
  const rows = await client<{ id: string }[]>`
    SELECT id FROM schema_migrations ORDER BY id
  `;

  return new Set(rows.map((row) => row.id));
}

async function run() {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await client.begin(async (tx) => {
      await tx.unsafe(sql);
      await tx`
        INSERT INTO schema_migrations (id) VALUES (${file})
      `;
    });
  }

  await client.end();
}

run().catch(async (error) => {
  console.error(error);
  await client.end({ timeout: 1 });
  process.exit(1);
});

