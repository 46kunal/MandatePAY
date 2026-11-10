/**
 * Sign and verify mandates as compact JWS (EdDSA / Ed25519) using `jose` (owner: B).
 *
 * Our token is AP2-shaped but NOT interoperable with the AP2 spec (different claims and keys).
 *
 * Verification never throws for bad input: it returns { ok: false, reason } so API routes can map
 * reasons to HTTP codes (e.g. "expired" -> 410) without catching exceptions.
 */
import { CompactSign, compactVerify, decodeProtectedHeader, errors } from 'jose';
import { OpenMandatePayload } from '../../contracts/schemas';
import { isBuyerKid, type BuyerKeyResolver, type BuyerSigningKey } from './buyerKeys';
import { ALG, getKeyPair, type KeyRole } from './keys';

export interface KeyOptions {
  /** Override KEY_DIR (tests use a temp directory). */
  keyDir?: string;
  /** Sign an open mandate with this buyer's own key instead of the shared buyer key. */
  buyerKey?: BuyerSigningKey;
  /** Look up a buyer key by kid when verifying (tests inject one; default reads the buyer_keys table). */
  resolveBuyerKey?: BuyerKeyResolver;
}

/** Which key signed an open mandate. "shared_key" is the single demo key used before per-buyer keys existed. */
export type MandateSigner = { kind: 'buyer_key'; kid: string; userId: string } | { kind: 'shared_key'; kid: string | undefined };

export type VerifyFailureReason = 'malformed' | 'bad_signature';

export type RawVerifyResult =
  | { ok: true; payload: unknown; kid: string | undefined }
  | { ok: false; reason: VerifyFailureReason; message: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Sign any JSON payload with the role's key. Prefer signOpenMandate for open mandates. */
export async function signJws(payload: object, role: KeyRole, opts: KeyOptions = {}): Promise<string> {
  const { privateKey, kid } = await getKeyPair(role, opts.keyDir);
  return new CompactSign(encoder.encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: ALG, kid })
    .sign(privateKey);
}

/** Verify a compact JWS against the role's public key. The algorithm is pinned to EdDSA. */
export async function verifyJws(jws: string, role: KeyRole, opts: KeyOptions = {}): Promise<RawVerifyResult> {
  const { publicKey } = await getKeyPair(role, opts.keyDir);
  return verifyWithKey(jws, publicKey);
}

async function verifyWithKey(jws: string, publicKey: Awaited<ReturnType<typeof getKeyPair>>['publicKey']): Promise<RawVerifyResult> {
  let verified: Awaited<ReturnType<typeof compactVerify>>;
  try {
    verified = await compactVerify(jws, publicKey, { algorithms: [ALG] });
  } catch (err) {
    if (err instanceof errors.JWSInvalid) {
      return { ok: false, reason: 'malformed', message: 'not a valid compact JWS' };
    }
    // Wrong key, altered payload or signature, disallowed algorithm (including "none").
    return { ok: false, reason: 'bad_signature', message: 'signature verification failed' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(verified.payload));
  } catch {
    return { ok: false, reason: 'malformed', message: 'payload is not valid JSON' };
  }
  return { ok: true, payload, kid: verified.protectedHeader.kid };
}

// ---------- open mandate ----------

export type OpenMandateVerifyResult =
  | { ok: true; payload: OpenMandatePayload; signer: MandateSigner }
  | { ok: false; reason: VerifyFailureReason | 'invalid_payload'; message: string }
  /** Signature was valid but the mandate is past its exp. The payload is returned so callers can log which one. */
  | { ok: false; reason: 'expired'; message: string; payload: OpenMandatePayload };

/**
 * Validate against the contract, then sign. With opts.buyerKey the buyer's own key signs (its kid goes in the header);
 * without it the shared buyer key does (tests and anything signed before per-buyer keys).
 */
export async function signOpenMandate(payload: OpenMandatePayload, opts: KeyOptions = {}): Promise<string> {
  const valid = OpenMandatePayload.parse(payload);
  if (!opts.buyerKey) return signJws(valid, 'buyer', opts);
  return new CompactSign(encoder.encode(JSON.stringify(valid)))
    .setProtectedHeader({ alg: ALG, kid: opts.buyerKey.kid })
    .sign(opts.buyerKey.privateKey);
}

/**
 * Check order: signature, then payload shape, then expiry. `now` is unix seconds (injectable for tests).
 * The guard route maps: malformed/bad_signature/invalid_payload -> reject, expired -> 410.
 */
export async function verifyOpenMandate(
  jws: string,
  opts: KeyOptions & { now?: number } = {},
): Promise<OpenMandateVerifyResult> {
  let kid: string | undefined;
  try {
    kid = decodeProtectedHeader(jws).kid;
  } catch {
    return { ok: false, reason: 'malformed', message: 'not a valid compact JWS' };
  }

  // A buyer's own key: find it by kid, verify, and require that its owner is the buyer the mandate names.
  let owner: string | undefined;
  let raw: RawVerifyResult;
  if (isBuyerKid(kid)) {
    const resolve = opts.resolveBuyerKey ?? (await import('./buyerKeys')).dbBuyerKeyResolver;
    const key = await resolve(kid);
    if (!key) return { ok: false, reason: 'bad_signature', message: 'signed with an unknown buyer key' };
    owner = key.userId;
    raw = await verifyWithKey(jws, key.publicKey);
  } else {
    raw = await verifyJws(jws, 'buyer', opts);
  }
  if (!raw.ok) return raw;

  const parsed = OpenMandatePayload.safeParse(raw.payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` (${first.path.join('.')})` : '';
    return { ok: false, reason: 'invalid_payload', message: `payload does not match OpenMandatePayload${where}` };
  }

  if (owner !== undefined && parsed.data.buyer_ref !== owner) {
    return { ok: false, reason: 'bad_signature', message: 'signed with a key that belongs to a different buyer' };
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (parsed.data.exp <= now) {
    return { ok: false, reason: 'expired', message: 'mandate has expired', payload: parsed.data };
  }
  const signer: MandateSigner = owner !== undefined && kid ? { kind: 'buyer_key', kid, userId: owner } : { kind: 'shared_key', kid };
  return { ok: true, payload: parsed.data, signer };
}
