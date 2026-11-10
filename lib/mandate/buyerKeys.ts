/**
 * Per-buyer mandate signing keys (owner: B).
 *
 * Every buyer gets their own Ed25519 key the first time they sign a mandate. The kid ("buyer-u-<hash>") goes in the
 * mandate's JWS header; verification looks the public key up by kid and requires the key's owner to be the mandate's
 * buyer_ref. A mandate therefore proves which buyer agreed, not just that "a buyer" did.
 *
 * Private keys are encrypted at rest with AES-256-GCM under a master key:
 *  - MANDATE_KEY_ENCRYPTION_KEY (32 random bytes, base64 or base64url). Required on Vercel.
 *  - Locally, if it is not set, KEY_DIR/master.key is created and used (gitignored, like the other key files).
 * Losing the master key makes stored buyer keys unusable for signing; already-signed mandates still verify, because
 * verification only needs the public key.
 */
import { createCipheriv, createDecipheriv, createHash, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { importPKCS8, importSPKI } from 'jose';
import { ALG, resolveKeyDir } from './keys';

export const BUYER_KID_PREFIX = 'buyer-u-';
export const MASTER_KEY_ENV = 'MANDATE_KEY_ENCRYPTION_KEY';

type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;
type VerifyingKey = Awaited<ReturnType<typeof importSPKI>>;

export interface BuyerSigningKey {
  kid: string;
  privateKey: SigningKey;
}

export interface BuyerPublicKey {
  kid: string;
  userId: string;
  publicKey: VerifyingKey;
}

/** Looks a buyer's public key up by kid. Injected in tests; the default reads the buyer_keys table. */
export type BuyerKeyResolver = (kid: string) => Promise<BuyerPublicKey | undefined>;

export function isBuyerKid(kid: string | undefined): kid is string {
  return typeof kid === 'string' && kid.startsWith(BUYER_KID_PREFIX);
}

/** kid from the public key itself, so it cannot drift from the key. */
export function buyerKid(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return `${BUYER_KID_PREFIX}${createHash('sha256').update(der).digest('hex').slice(0, 20)}`;
}

// ---------- encryption at rest (pure, tested) ----------

export function parseMasterKey(raw: string): Buffer {
  const key = Buffer.from(raw.trim(), raw.includes('-') || raw.includes('_') ? 'base64url' : 'base64');
  if (key.length !== 32) throw new Error(`${MASTER_KEY_ENV} must be 32 random bytes (base64), got ${key.length}.`);
  return key;
}

/** "v1.<iv>.<tag>.<ciphertext>". The buyer's user id is bound in as associated data: a row copied to another user fails. */
export function encryptPrivateKey(pem: string, master: Buffer, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', master, iv);
  cipher.setAAD(Buffer.from(userId, 'utf8'));
  const ct = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptPrivateKey(blob: string, master: Buffer, userId: string): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unknown buyer key format.');
  const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(userId, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

let masterCache: Promise<Buffer> | undefined;

/** The master key: env first; locally a generated file; on Vercel without the env it refuses. */
export function getMasterKey(): Promise<Buffer> {
  masterCache ??= (async () => {
    const env = process.env[MASTER_KEY_ENV];
    if (env?.trim()) return parseMasterKey(env);
    if (process.env.VERCEL === '1') {
      throw new Error(`${MASTER_KEY_ENV} is not set. On Vercel buyer keys need it (npm run keys:export).`);
    }
    const file = path.join(resolveKeyDir(), 'master.key');
    try {
      return parseMasterKey(await fs.readFile(file, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const fresh = randomBytes(32).toString('base64');
    await fs.writeFile(file, fresh, { mode: 0o600, flag: 'wx' }).catch(() => undefined); // another process may win
    return parseMasterKey(await fs.readFile(file, 'utf8'));
  })();
  masterCache.catch(() => (masterCache = undefined));
  return masterCache;
}

// ---------- database ----------

async function load() {
  const [{ eq }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  return { eq, db, schema };
}

/** The buyer's signing key, created on first use. Safe under concurrent first use (one row per user). */
export async function getOrCreateBuyerKey(userId: string): Promise<BuyerSigningKey> {
  const { eq, db, schema } = await load();
  const master = await getMasterKey();

  let [row] = await db.select().from(schema.buyerKeys).where(eq(schema.buyerKeys.userId, userId)).limit(1);
  if (!row) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await db
      .insert(schema.buyerKeys)
      .values({ userId, kid: buyerKid(publicPem), publicKeyPem: publicPem, privateKeyEnc: encryptPrivateKey(privatePem, master, userId) })
      .onConflictDoNothing({ target: schema.buyerKeys.userId });
    [row] = await db.select().from(schema.buyerKeys).where(eq(schema.buyerKeys.userId, userId)).limit(1);
    if (!row) throw new Error('Could not create the buyer signing key.');
  }
  const pem = decryptPrivateKey(row.privateKeyEnc, master, userId);
  return { kid: row.kid, privateKey: await importPKCS8(pem, ALG) };
}

/** Default resolver: public key and owner for a kid, from the buyer_keys table. */
export const dbBuyerKeyResolver: BuyerKeyResolver = async (kid) => {
  const { eq, db, schema } = await load();
  const [row] = await db
    .select({ userId: schema.buyerKeys.userId, publicKeyPem: schema.buyerKeys.publicKeyPem })
    .from(schema.buyerKeys)
    .where(eq(schema.buyerKeys.kid, kid))
    .limit(1);
  if (!row) return undefined;
  return { kid, userId: row.userId, publicKey: await importSPKI(row.publicKeyPem, ALG) };
};
