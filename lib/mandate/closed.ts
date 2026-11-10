/**
 * Closed mandate and receipt hash (owner: B). Used by Person A at capture time.
 *
 * A closed mandate binds ONE cart to the open mandate: it carries the hash of the signed open mandate,
 * the hash of the canonical cart, and the total. It is signed by the buyer key when the buyer clicked
 * approve, or by the agent key when no approval was needed.
 */
import { createHash } from 'node:crypto';
import { ClosedMandatePayload, type Cart } from '../../contracts/schemas';
import { CompactSign, compactVerify, decodeProtectedHeader } from 'jose';
import { isBuyerKid } from './buyerKeys';
import { signJws, verifyJws, type KeyOptions, type RawVerifyResult, type VerifyFailureReason } from './jws';
import { ALG } from './keys';
import { cartTotalMinor, fromMinor } from './money';

/** JSON with object keys sorted at every level, so equal data always hashes equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

export const hashCart = (cart: Cart): string => sha256(canonicalJson(cart));

/** Hash of the signed open mandate token exactly as stored in mandates.jws. */
export const hashOpenMandate = (openMandateJws: string): string => sha256(openMandateJws);

export interface CreateClosedMandateInput {
  mandateId: string;
  openMandateJws: string;
  cart: Cart;
  approvedBy: 'buyer' | 'agent';
  /** Unix seconds, injectable for tests. */
  now?: number;
}

export interface ClosedMandate {
  jws: string;
  payload: ClosedMandatePayload;
}

/** Build and sign the closed mandate. The total is recomputed from the cart, never passed in. */
export async function createClosedMandate(input: CreateClosedMandateInput, opts: KeyOptions = {}): Promise<ClosedMandate> {
  const payload = ClosedMandatePayload.parse({
    typ: 'checkout_mandate.closed',
    mandate_id: input.mandateId,
    open_mandate_hash: hashOpenMandate(input.openMandateJws),
    cart_hash: hashCart(input.cart),
    total: fromMinor(cartTotalMinor(input.cart)),
    currency: input.cart.currency,
    approved_by: input.approvedBy,
    iat: input.now ?? Math.floor(Date.now() / 1000),
  });
  if (input.approvedBy === 'buyer' && opts.buyerKey) {
    // The buyer approved this cart: their own key signs, like their open mandate.
    const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
      .setProtectedHeader({ alg: ALG, kid: opts.buyerKey.kid })
      .sign(opts.buyerKey.privateKey);
    return { jws, payload };
  }
  return { jws: await signJws(payload, input.approvedBy, opts), payload };
}

/** The buyer_ref and signing kid of an open mandate, read without verifying (callers verify it separately). */
export function openMandateSigner(openMandateJws: string): { buyerRef?: string; kid?: string } {
  try {
    const kid = decodeProtectedHeader(openMandateJws).kid;
    const body = JSON.parse(Buffer.from(openMandateJws.split('.')[1] ?? '', 'base64url').toString('utf8')) as { buyer_ref?: unknown };
    return { kid, buyerRef: typeof body.buyer_ref === 'string' ? body.buyer_ref : undefined };
  } catch {
    return {};
  }
}

/** Buyer-approved closed mandate signed with a buyer key: verify with that key; its owner must be the open mandate's buyer. */
async function verifyBuyerSigned(jws: string, kid: string, openMandateJws: string | undefined, opts: KeyOptions): Promise<RawVerifyResult> {
  const resolve = opts.resolveBuyerKey ?? (await import('./buyerKeys')).dbBuyerKeyResolver;
  const key = await resolve(kid);
  if (!key) return { ok: false, reason: 'bad_signature', message: 'signed with an unknown buyer key' };
  if (openMandateJws && openMandateSigner(openMandateJws).buyerRef !== key.userId) {
    return { ok: false, reason: 'bad_signature', message: 'approved with a key that does not belong to the mandate buyer' };
  }
  try {
    const v = await compactVerify(jws, key.publicKey, { algorithms: [ALG] });
    return { ok: true, payload: JSON.parse(new TextDecoder().decode(v.payload)), kid };
  } catch {
    return { ok: false, reason: 'bad_signature', message: 'signature verification failed' };
  }
}

export type ClosedMandateVerifyResult =
  | { ok: true; payload: ClosedMandatePayload }
  | { ok: false; reason: VerifyFailureReason | 'invalid_payload' | 'mismatch'; message: string };

/**
 * Verify the signature with the role that signed it (carts.approved_by), then, if the caller supplies them,
 * check that the token really binds this open mandate and this cart.
 */
export async function verifyClosedMandate(
  jws: string,
  approvedBy: 'buyer' | 'agent',
  expected: { openMandateJws?: string; cart?: Cart } = {},
  opts: KeyOptions = {},
): Promise<ClosedMandateVerifyResult> {
  let kid: string | undefined;
  try {
    kid = decodeProtectedHeader(jws).kid;
  } catch {
    return { ok: false, reason: 'malformed', message: 'not a valid compact JWS' };
  }
  const raw =
    approvedBy === 'buyer' && isBuyerKid(kid)
      ? await verifyBuyerSigned(jws, kid, expected.openMandateJws, opts)
      : await verifyJws(jws, approvedBy, opts);
  if (!raw.ok) return raw;

  const parsed = ClosedMandatePayload.safeParse(raw.payload);
  if (!parsed.success) return { ok: false, reason: 'invalid_payload', message: 'payload does not match ClosedMandatePayload' };
  const p = parsed.data;

  if (p.approved_by !== approvedBy) return { ok: false, reason: 'mismatch', message: 'approved_by does not match the signing key' };
  if (expected.openMandateJws && p.open_mandate_hash !== hashOpenMandate(expected.openMandateJws)) {
    return { ok: false, reason: 'mismatch', message: 'closed mandate does not bind this open mandate' };
  }
  if (expected.cart && (p.cart_hash !== hashCart(expected.cart) || p.total !== fromMinor(cartTotalMinor(expected.cart)))) {
    return { ok: false, reason: 'mismatch', message: 'closed mandate does not bind this cart' };
  }
  return { ok: true, payload: p };
}

export interface ReceiptInput {
  mandateId: string;
  cartId: string;
  cartHash: string;
  paypalOrderId: string;
  captureId: string;
}

/** orders.receipt_hash: sha256 over the mandate, cart, order and capture identifiers. Call at capture time. */
export function computeReceiptHash(input: ReceiptInput): string {
  return sha256(canonicalJson(input));
}
