import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";

export type PasswordHashOptions = {
  cost?: number;
  blockSize?: number;
  parallelization?: number;
  keyLength?: number;
  saltBytes?: number;
};

const defaultOptions: Required<PasswordHashOptions> = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
  keyLength: 64,
  saltBytes: 16,
};

export async function hashPassword(password: string, options: PasswordHashOptions = {}) {
  const resolved = resolveOptions(options);
  const salt = randomBytes(resolved.saltBytes);
  const derived = await scrypt(password, salt, resolved);
  return [
    "scrypt",
    "v=1",
    `N=${resolved.cost}`,
    `r=${resolved.blockSize}`,
    `p=${resolved.parallelization}`,
    `keylen=${resolved.keyLength}`,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, storedHash: string) {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return false;
  const derived = await scrypt(password, parsed.salt, parsed.options);
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

function resolveOptions(options: PasswordHashOptions): Required<PasswordHashOptions> {
  return {
    cost: options.cost ?? defaultOptions.cost,
    blockSize: options.blockSize ?? defaultOptions.blockSize,
    parallelization: options.parallelization ?? defaultOptions.parallelization,
    keyLength: options.keyLength ?? defaultOptions.keyLength,
    saltBytes: options.saltBytes ?? defaultOptions.saltBytes,
  };
}

function parsePasswordHash(storedHash: string) {
  const [algorithm, version, cost, blockSize, parallelization, keyLength, salt, hash] = storedHash.split("$");
  if (algorithm !== "scrypt" || version !== "v=1") return null;
  const options = {
    cost: readNumberPart(cost, "N"),
    blockSize: readNumberPart(blockSize, "r"),
    parallelization: readNumberPart(parallelization, "p"),
    keyLength: readNumberPart(keyLength, "keylen"),
    saltBytes: 0,
  };
  if (!options.cost || !options.blockSize || !options.parallelization || !options.keyLength || !salt || !hash) {
    return null;
  }
  return {
    options,
    salt: Buffer.from(salt, "base64url"),
    hash: Buffer.from(hash, "base64url"),
  };
}

function readNumberPart(part: string | undefined, key: string) {
  const prefix = `${key}=`;
  if (!part?.startsWith(prefix)) return 0;
  const value = Number.parseInt(part.slice(prefix.length), 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function scrypt(password: string, salt: Buffer, options: Required<PasswordHashOptions>) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      options.keyLength,
      {
        N: options.cost,
        r: options.blockSize,
        p: options.parallelization,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey as Buffer);
      },
    );
  });
}
