/**
 * Closed mandate and receipt hash (owner: B). Used by Person A at capture time.
 *
 * A closed mandate binds ONE cart to the open mandate: it carries the hash of the signed open mandate,
 * the hash of the canonical cart, and the total. It is signed by the buyer key when the buyer clicked
 * approve, or by the agent key when no approval was needed.
 */
import { createHash } from 'node:crypto';
import { ClosedMandatePayload, type Cart } from '../../contracts/schemas';
import { signJws, verifyJws, type KeyOptions, type VerifyFailureReason } from './jws';
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
  return { jws: await signJws(payload, input.approvedBy, opts), payload };
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
  const raw = await verifyJws(jws, approvedBy, opts);
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
