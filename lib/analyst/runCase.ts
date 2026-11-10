/**
 * Analyse a stored dispute case (owner: B). Shared by the "Analyse" button (POST /api/cases/:id/analyse) and the
 * automatic run after a webhook or poll brings in a dispute.
 *
 * The input is built only from records: the PayPal dispute, the signed mandate's constraints, the cart, the guard
 * result, and the payment facts (who paid, which key signed the mandate).
 */
import type { Constraints, Verdict } from '../../contracts/schemas';
import { LlmError } from '../ai';
import { payerCheck } from '../auth/paypalIdentity';
import { isBuyerKid } from '../mandate/buyerKeys';
import { openMandateSigner } from '../mandate/closed';
import { toDisputeSummary, type RawDispute } from '../paypal/disputes';
import { refreshOrderRefunds, refundedView } from '../paypal/refunds';
import { getSettings } from '../settings';
import { analyseCase } from './analyst';

export type RunCaseResult =
  | { ok: true; verdict: Verdict }
  | { ok: false; status: 404 | 422 | 500 | 502; error: string; message: string; details?: unknown };

export async function analyseStoredCase(disputeId: string): Promise<RunCaseResult> {
  const [{ eq, or }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  const [theCase] = await db.select().from(schema.cases).where(eq(schema.cases.disputeId, disputeId)).limit(1);
  if (!theCase) return { ok: false, status: 404, error: 'case_not_found', message: `No case with id ${disputeId}.` };
  if (!theCase.rawDispute || !theCase.mandateId) {
    return {
      ok: false,
      status: 422,
      error: 'case_not_linked',
      message: 'This dispute is not linked to one of our mandates yet, so there is nothing to analyse.',
    };
  }

  const [mandate] = await db.select().from(schema.mandates).where(eq(schema.mandates.mandateId, theCase.mandateId)).limit(1);
  const orderMatch = [
    theCase.paypalOrderId ? eq(schema.orders.paypalOrderId, theCase.paypalOrderId) : undefined,
    theCase.captureId ? eq(schema.orders.captureId, theCase.captureId) : undefined,
  ].filter((c) => c !== undefined);
  const [order] = orderMatch.length ? await db.select().from(schema.orders).where(or(...orderMatch)).limit(1) : [];
  const [cartRow] = order ? await db.select().from(schema.carts).where(eq(schema.carts.cartId, order.cartId)).limit(1) : [];
  if (!mandate || !cartRow) {
    return { ok: false, status: 422, error: 'case_not_linked', message: 'The mandate or cart for this dispute could not be found.' };
  }

  const [buyer] = await db
    .select({ paypalPayerId: schema.users.paypalPayerId })
    .from(schema.users)
    .where(eq(schema.users.id, mandate.userId))
    .limit(1);
  const refunds = order ? await refreshOrderRefunds(order.paypalOrderId, { maxAgeMs: 60_000 }) : [];
  const payment = {
    refund: refundedView(refunds, theCase.amountMinor),
    source: order?.paymentSource ?? null,
    payer_check: payerCheck(order?.payerId, buyer?.paypalPayerId),
    mandate_signed_with: isBuyerKid(openMandateSigner(mandate.jws).kid) ? ('buyer_key' as const) : ('shared_key' as const),
  };

  const settings = await getSettings();
  try {
    const verdict = await analyseCase(
      {
        dispute: toDisputeSummary(theCase.rawDispute as unknown as RawDispute),
        mandate: { mandate_id: mandate.mandateId, constraints: mandate.constraints as Constraints },
        cart: cartRow.cart,
        guard: cartRow.guard,
        payment,
      },
      { humanReviewOver: settings.human_review_over, minConfidence: settings.min_confidence },
    );
    await db
      .update(schema.cases)
      .set({ verdict, analysisStatus: verdict.needs_human ? 'awaiting_human' : 'analysed', updatedAt: new Date() })
      .where(eq(schema.cases.disputeId, disputeId));
    return { ok: true, verdict };
  } catch (err) {
    if (err instanceof LlmError) {
      return { ok: false, status: err.code === 'config' ? 500 : 502, error: 'llm_failed', message: err.message, details: { code: err.code } };
    }
    throw err;
  }
}

/** Pure: should a case be analysed automatically now? */
export function shouldAutoAnalyse(c: {
  analysisStatus: string;
  mandateId: string | null;
  rawDispute: unknown;
}): boolean {
  if (c.analysisStatus !== 'pending' || !c.mandateId || !c.rawDispute) return false;
  // Only once PayPal lets the seller do something; analysing while it is under review would see no options.
  const actions = toDisputeSummary(c.rawDispute as RawDispute).allowed_actions.filter((a) => a !== 'NO_ACTION');
  return actions.length > 0;
}

/** At most this many analyses per webhook or poll, to protect the AI quota. */
export const AUTO_ANALYSE_LIMIT = 3;

/**
 * Analyse the cases that are linked, not analysed yet, and actionable. Runs after the webhook or poll has answered.
 * Never throws: failures are logged, and the case stays pending for the Analyse button.
 */
export async function autoAnalysePending(): Promise<string[]> {
  const settings = await getSettings();
  if (!settings.auto_analyse) return [];
  const [{ and, asc, eq, isNotNull }, { db, schema }, { audit }] = await Promise.all([
    import('drizzle-orm'),
    import('../../db/client'),
    import('../audit'),
  ]);
  const pending = await db
    .select({ disputeId: schema.cases.disputeId, analysisStatus: schema.cases.analysisStatus, mandateId: schema.cases.mandateId, rawDispute: schema.cases.rawDispute })
    .from(schema.cases)
    .where(and(eq(schema.cases.analysisStatus, 'pending'), isNotNull(schema.cases.mandateId)))
    .orderBy(asc(schema.cases.createdAt))
    .limit(20);

  const done: string[] = [];
  for (const c of pending.filter(shouldAutoAnalyse).slice(0, AUTO_ANALYSE_LIMIT)) {
    try {
      const r = await analyseStoredCase(c.disputeId);
      if (r.ok) {
        done.push(c.disputeId);
        await audit(null, {
          action: 'case.auto_analyse',
          targetType: 'case',
          targetId: c.disputeId,
          details: { fault: r.verdict.fault, action: r.verdict.action, needs_human: r.verdict.needs_human },
        });
      } else {
        console.error(`[auto-analyse] ${c.disputeId}: ${r.error} ${r.message}`);
      }
    } catch (err) {
      console.error(`[auto-analyse] ${c.disputeId}: ${(err as Error).message}`);
    }
  }
  return done;
}
