import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import type { AppConfig } from '../config.js';

export function createDb(config: AppConfig) {
  const client = postgres(config.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client);
}

export async function ensureSchema(db: ReturnType<typeof createDb>) {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE,
      destination_url text NOT NULL,
      title text,
      description text,
      status text NOT NULL DEFAULT 'active',
      click_count integer NOT NULL DEFAULT 0,
      last_clicked_at timestamptz,
      created_by text,
      expires_at timestamptz,
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS link_clicks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      link_id uuid NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      clicked_at timestamptz NOT NULL DEFAULT now(),
      referrer text,
      user_agent text,
      country text,
      ip_hash text
    )
  `);
}
