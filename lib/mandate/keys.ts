/**
 * Ed25519 key handling for mandate signing (owner: B).
 *
 * Two roles sign mandates (see contracts/schemas.ts):
 *  - "buyer": signs the open mandate when the buyer confirms it.
 *  - "agent": signs a closed mandate when the cart was within limits and needed no approval.
 *
 * Where keys come from, in order:
 *  1. MANDATE_BUYER_PRIVATE_KEY / MANDATE_AGENT_PRIVATE_KEY (base64 of the PKCS#8 PEM, or the PEM itself).
 *     Used on hosts with no lasting disk (Vercel). Export the local keys with `npm run keys:export`.
 *  2. Files in KEY_DIR (default ".keys", gitignored), created on first use. Local and Docker only.
 * On Vercel without the env keys this fails loudly: a key generated per instance would make every
 * signature unverifiable on the next instance.
 * The private key PEM is the single source of truth: the public key is derived from it. Sandbox/demo only: a real deployment would keep the buyer
 * key on the buyer's device or in a KMS, not on the server.
 */
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { importPKCS8, importSPKI } from 'jose';

export type KeyRole = 'buyer' | 'agent';
export const KEY_ROLES: readonly KeyRole[] = ['buyer', 'agent'];

/** JOSE algorithm name for Ed25519. Pinned on both sign and verify so a token cannot pick its own alg. */
export const ALG = 'EdDSA' as const;

type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;
type VerifyingKey = Awaited<ReturnType<typeof importSPKI>>;

export interface MandateKeyPair {
  role: KeyRole;
  /** Stable id derived from the public key, put in the JWS protected header. */
  kid: string;
  privateKey: SigningKey;
  publicKey: VerifyingKey;
}

const cache = new Map<string, Promise<MandateKeyPair>>();

/** Absolute key directory: explicit argument, then KEY_DIR, then ".keys". Empty strings count as unset. */
export function resolveKeyDir(dir?: string): string {
  const chosen = dir?.trim() || process.env.KEY_DIR?.trim() || '.keys';
  // Runtime-chosen directory: tell the bundler not to trace it (it would pull the whole project into the build).
  return path.resolve(/*turbopackIgnore: true*/ chosen);
}

/** Load the key pair for a role, creating and persisting it on first use. Cached per directory and role. */
export function getKeyPair(role: KeyRole, dir?: string): Promise<MandateKeyPair> {
  // An explicit directory (tests) always means files; otherwise an env key wins.
  const fromEnv = dir === undefined ? envPrivateKey(role) : undefined;
  const resolved = resolveKeyDir(dir);
  const cacheKey = fromEnv !== undefined ? `env::${role}` : `${resolved}::${role}`;
  let pending = cache.get(cacheKey);
  if (!pending) {
    pending = fromEnv !== undefined ? fromPem(role, fromEnv) : loadOrCreate(role, resolved);
    cache.set(cacheKey, pending);
    // Do not cache failures: the next call should try again.
    pending.catch(() => cache.delete(cacheKey));
  }
  return pending;
}

/** Test helper: forget cached keys so the next call reads from disk again. */
export function resetKeyCache(): void {
  cache.clear();
}

/** Env variable holding a role's private key. */
export function keyEnvName(role: KeyRole): string {
  return `MANDATE_${role.toUpperCase()}_PRIVATE_KEY`;
}

/** The role's private key PEM from the environment, or undefined. Accepts a PEM or base64 of a PEM. */
export function envPrivateKey(role: KeyRole, env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env[keyEnvName(role)]?.trim();
  if (!raw) {
    if (env.VERCEL === '1') {
      throw new Error(`${keyEnvName(role)} is not set. On Vercel mandate keys must come from env (npm run keys:export).`);
    }
    return undefined;
  }
  // A PEM pasted into one line has literal "\n" sequences; turn them back into newlines.
  const pem = raw.includes('-----BEGIN') ? raw.replace(/\\n/g, '\n') : Buffer.from(raw, 'base64').toString('utf8');
  if (!pem.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error(`${keyEnvName(role)} is not a PKCS#8 private key PEM (or base64 of one).`);
  }
  return pem;
}

async function loadOrCreate(role: KeyRole, dir: string): Promise<MandateKeyPair> {
  const privatePath = path.join(dir, `${role}.private.pem`);

  let privatePem = await readIfExists(privatePath);
  if (privatePem === undefined) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const generated = generateKeyPairSync('ed25519')
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    await createExclusive(privatePath, generated);
    // If another process created the file first, createExclusive kept theirs: read what is really there.
    privatePem = (await readIfExists(privatePath)) ?? generated;
  }
  return fromPem(role, privatePem);
}

async function fromPem(role: KeyRole, privatePem: string): Promise<MandateKeyPair> {
  const derived = createPublicKey(privatePem);
  const publicPem = derived.export({ type: 'spki', format: 'pem' }).toString();
  const publicDer = derived.export({ type: 'spki', format: 'der' });
  const kid = `${role}-${createHash('sha256').update(publicDer).digest('hex').slice(0, 16)}`;

  const [privateKey, publicKey] = await Promise.all([
    importPKCS8(privatePem, ALG),
    importSPKI(publicPem, ALG),
  ]);
  return { role, kid, privateKey, publicKey };
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Write a file only if it does not exist yet, atomically: write a private temp file, then hard-link
 * it into place (link fails with EEXIST if a concurrent process won the race). Mode 0600 where the
 * OS supports it.
 */
async function createExclusive(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, contents, { mode: 0o600, flag: 'wx' });
  try {
    await fs.link(tmp, file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}
