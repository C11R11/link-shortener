import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/index.js';
import { users } from '../db/schema.js';
import { createAuthService } from '../auth/service.js';
import { AuthError } from '../auth/types.js';
import { loadConfig } from '../config.js';

interface ParsedArgs {
  email?: string;
  password?: string;
  passwordStdin?: boolean;
  name?: string;
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
    else if (key === 'password-stdin') out.passwordStdin = true;
    else if (key === 'name') out.name = value;
  }
  return out;
}

function printUsage(): void {
  console.error(
    'Usage: create-admin --email <email> (--password <password> | --password-stdin) [--name <name>]',
  );
}

async function promptForPassword(): Promise<string> {
  class MutedOutput extends Writable {
    muted = false;

    override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      if (!this.muted) process.stdout.write(chunk, encoding);
      callback();
    }
  }

  const output = new MutedOutput();
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const password = await new Promise<string>((resolve) => {
    rl.question('Administrator password: ', (answer) => resolve(answer));
    output.muted = true;
  });
  output.muted = false;
  process.stdout.write('\n');
  rl.close();
  return password;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.passwordStdin) {
    args.password = readFileSync(0, 'utf8').replace(/[\r\n]+$/, '');
  } else if (!args.password && process.stdin.isTTY) {
    args.password = await promptForPassword();
  }

  if (!args.email || !args.password) {
    printUsage();
    process.exit(1);
  }

  const config = loadConfig();
  const db = createDb(config);
  const auth = createAuthService(config, db);

  try {
    await auth.createUser({
      email: args.email,
      name: args.name,
      password: args.password,
    });
    console.log(`Created admin user: ${args.email}`);
    process.exit(0);
  } catch (err) {
    if (err instanceof AuthError && err.code === 'email_taken') {
      console.log('User already exists');
      process.exit(0);
    }
    if (err instanceof AuthError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    process.exit(1);
  } finally {
    // Best-effort cleanup of the underlying postgres pool.
    try {
      // drizzle-orm/postgres-js exposes the underlying client via $client on the
      // driver; close it to release connections before exit.
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
