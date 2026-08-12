import { argon2id, argon2Verify } from 'hash-wasm';

const SALT_LENGTH = 16;
const HASH_LENGTH = 32;
const MEMORY_SIZE = 65536; // 64 MiB in KiB
const ITERATIONS = 3;
const PARALLELISM = 4;

function generateSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return salt;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = generateSalt();
  return argon2id({
    password: plain,
    salt,
    iterations: ITERATIONS,
    parallelism: PARALLELISM,
    memorySize: MEMORY_SIZE,
    hashLength: HASH_LENGTH,
    outputType: 'encoded',
  });
}

export async function verifyPassword(plain: string, encodedHash: string): Promise<boolean> {
  if (!encodedHash) return false;
  try {
    return await argon2Verify({ password: plain, hash: encodedHash });
  } catch {
    return false;
  }
}
