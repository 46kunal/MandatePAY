/**
 * Cart check (owner: B): verify the signed mandate, then run the guard against the VERIFIED constraints.
 * Constraints are always read from the signed token, never from the unsigned database column.
 *
 * Person A's order creation should call checkCartById() directly instead of making an HTTP call.
 */
import type { Cart, Constraints, GuardResult } from '../../contracts/schemas';
import { resolveUnsure } from './fuzzy';
import { evaluateCart } from './guard';
import { verifyOpenMandate, type KeyOptions } from './jws';

export type CheckCartOutcome =
  | { ok: true; guard: GuardResult; constraints: Constraints; mandateId: string }
  | { ok: false; status: 404 | 410 | 422; error: 'mandate_not_found' | 'mandate_expired' | 'mandate_invalid' | 'mandate_revoked'; message: string };

export interface CheckCartOptions extends KeyOptions {
  /** Unix seconds, injectable for tests. */
  now?: number;
  /** Fallback approval threshold (defaults to the store setting, which defaults to APPROVAL_THRESHOLD). */
  approvalThreshold?: string;
  /** Let the LLM settle "unsure" checks (B7). Default true; it can never override a failed check. */
  fuzzy?: boolean;
}

/** Verify a mandate token and evaluate the cart. Pure apart from reading the signing key. */
export async function checkCart(mandateJws: string, cart: Cart, opts: CheckCartOptions = {}): Promise<CheckCartOutcome> {
  const verified = await verifyOpenMandate(mandateJws, opts);
  if (!verified.ok) {
    if (verified.reason === 'expired') {
      return { ok: false, status: 410, error: 'mandate_expired', message: verified.message };
    }
    return { ok: false, status: 422, error: 'mandate_invalid', message: `Mandate failed verification: ${verified.message}` };
  }

  let approvalThreshold = opts.approvalThreshold;
  if (approvalThreshold === undefined) {
    const { getSettings } = await import('../settings');
    approvalThreshold = (await getSettings()).approval_threshold;
  }

  const { constraints, mandate_id } = verified.payload;
  let guard = evaluateCart(constraints, cart, { approvalThreshold });
  if (opts.fuzzy !== false) guard = await resolveUnsure(guard, constraints, cart);
  return { ok: true, guard, constraints, mandateId: mandate_id };
}

/** Look the mandate up by id, then checkCart(). */
export async function checkCartById(mandateId: string, cart: Cart, opts: CheckCartOptions = {}): Promise<CheckCartOutcome> {
  const [{ eq }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  const [row] = await db.select().from(schema.mandates).where(eq(schema.mandates.mandateId, mandateId)).limit(1);
  if (!row) return { ok: false, status: 404, error: 'mandate_not_found', message: `No mandate with id ${mandateId}.` };
  if (row.revokedAt) return { ok: false, status: 410, error: 'mandate_revoked', message: 'The buyer revoked this mandate. Sign a new one to keep shopping.' };
  return checkCart(row.jws, cart, opts);
}
