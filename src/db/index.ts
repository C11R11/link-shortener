import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { AppConfig } from '../config.js';

export function createDb(config: AppConfig) {
  const client = postgres(config.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client);
}
