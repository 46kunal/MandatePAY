/**
 * Sign and verify mandates as compact JWS (EdDSA / Ed25519) using `jose` (owner: B).
 *
 * Our token is AP2-shaped but NOT interoperable with the AP2 spec (different claims and keys).
 *
 * Verification never throws for bad input: it returns { ok: false, reason } so API routes can map
 * reasons to HTTP codes (e.g. "expired" -> 410) without catching exceptions.
 */
import { CompactSign, compactVerify, errors } from 'jose';
import { OpenMandatePayload } from '../../contracts/schemas';
import { ALG, getKeyPair, type KeyRole } from './keys';

export interface KeyOptions {
  /** Override KEY_DIR (tests use a temp directory). */
  keyDir?: string;
}

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
  | { ok: true; payload: OpenMandatePayload }
  | { ok: false; reason: VerifyFailureReason | 'invalid_payload'; message: string }
  /** Signature was valid but the mandate is past its exp. The payload is returned so callers can log which one. */
  | { ok: false; reason: 'expired'; message: string; payload: OpenMandatePayload };

/** Validate against the contract, then sign with the buyer key. Throws if the payload does not match the contract. */
export async function signOpenMandate(payload: OpenMandatePayload, opts: KeyOptions = {}): Promise<string> {
  return signJws(OpenMandatePayload.parse(payload), 'buyer', opts);
}

/**
 * Check order: signature, then payload shape, then expiry. `now` is unix seconds (injectable for tests).
 * The guard route maps: malformed/bad_signature/invalid_payload -> reject, expired -> 410.
 */
export async function verifyOpenMandate(
  jws: string,
  opts: KeyOptions & { now?: number } = {},
): Promise<OpenMandateVerifyResult> {
  const raw = await verifyJws(jws, 'buyer', opts);
  if (!raw.ok) return raw;

  const parsed = OpenMandatePayload.safeParse(raw.payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` (${first.path.join('.')})` : '';
    return { ok: false, reason: 'invalid_payload', message: `payload does not match OpenMandatePayload${where}` };
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (parsed.data.exp <= now) {
    return { ok: false, reason: 'expired', message: 'mandate has expired', payload: parsed.data };
  }
  return { ok: true, payload: parsed.data };
}
