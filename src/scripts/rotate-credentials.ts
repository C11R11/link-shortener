import { eq } from 'drizzle-orm';
import { createDb } from '../db/index.js';
import { users } from '../db/schema.js';
import { createAuthService } from '../auth/service.js';
import { AuthError } from '../auth/types.js';
import { loadConfig } from '../config.js';

interface ParsedArgs {
  email?: string;
  password?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    let key: string;
    let value: string | undefined;
    const eqIdx = arg.indexOf('=');
    if (eqIdx >= 0) {
      key = arg.slice(2, eqIdx);
      value = arg.slice(eqIdx + 1);
    } else {
      key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        value = next;
        i += 1;
      }
    }

    if (key === 'email') out.email = value;
    else if (key === 'password') out.password = value;
  }
  return out;
}

function printUsage(): void {
  console.error('Usage: rotate-credentials --email <email> --password <password>');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email || !args.password) {
    printUsage();
    process.exit(1);
  }

  const config = loadConfig();
  const db = createDb(config);
  const auth = createAuthService(config, db);

  try {
    const normalizedEmail = args.email.trim().toLowerCase();
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    const user = rows[0];
    if (!user) {
      console.error(`User not found: ${args.email}`);
      process.exit(1);
    }

    await auth.updatePassword(user.id, args.password);
    console.log(`Rotated credentials for: ${args.email}`);
    process.exit(0);
  } catch (err) {
    if (err instanceof AuthError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    process.exit(1);
  } finally {
    try {
      const maybeClient = (db as unknown as { $client?: { end: (opts?: { timeout?: number }) => Promise<void> } }).$client;
      if (maybeClient && typeof maybeClient.end === 'function') {
        await maybeClient.end({ timeout: 1 });
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
