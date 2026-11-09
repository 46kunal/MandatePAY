import { eq, or } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { LlmError } from '@/lib/ai';
import { analyseCase } from '@/lib/analyst/analyst';
import { getSettings } from '@/lib/settings';
import { apiError } from '@/lib/http';
import { toDisputeSummary, type RawDispute } from '@/lib/paypal';
import type { Constraints } from '@/contracts/schemas';
import { requirePermission } from '@/lib/auth/guard';

export const runtime = 'nodejs';
// Calls the AI model: up to 60 s per attempt plus one fallback attempt.
export const maxDuration = 150;

// OWNER: B. POST -> Verdict, saved on the case. Input: DisputeSummary + mandate + cart + tracking.
// The analyst may only choose actions listed in DisputeSummary.allowed_actions (enforced in lib/analyst).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'cases:analyse');
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const [theCase] = await db.select().from(schema.cases).where(eq(schema.cases.disputeId, id)).limit(1);
  if (!theCase) return apiError(404, 'case_not_found', `No case with id ${id}.`);
  if (!theCase.rawDispute || !theCase.mandateId) {
    return apiError(422, 'case_not_linked', 'This dispute is not linked to one of our mandates yet, so there is nothing to analyse.');
  }

  const [mandate] = await db.select().from(schema.mandates).where(eq(schema.mandates.mandateId, theCase.mandateId)).limit(1);
  const orderMatch = [
    theCase.paypalOrderId ? eq(schema.orders.paypalOrderId, theCase.paypalOrderId) : undefined,
    theCase.captureId ? eq(schema.orders.captureId, theCase.captureId) : undefined,
  ].filter((c) => c !== undefined);
  const [order] = orderMatch.length ? await db.select().from(schema.orders).where(or(...orderMatch)).limit(1) : [];
  const [cartRow] = order ? await db.select().from(schema.carts).where(eq(schema.carts.cartId, order.cartId)).limit(1) : [];
  if (!mandate || !cartRow) return apiError(422, 'case_not_linked', 'The mandate or cart for this dispute could not be found.');

  const settings = await getSettings();
  try {
    const verdict = await analyseCase(
      {
        dispute: toDisputeSummary(theCase.rawDispute as unknown as RawDispute),
        mandate: { mandate_id: mandate.mandateId, constraints: mandate.constraints as Constraints },
        cart: cartRow.cart,
        guard: cartRow.guard,
      },
      { humanReviewOver: settings.human_review_over, minConfidence: settings.min_confidence },
    );

    await db
      .update(schema.cases)
      .set({ verdict, analysisStatus: verdict.needs_human ? 'awaiting_human' : 'analysed', updatedAt: new Date() })
      .where(eq(schema.cases.disputeId, id));
    return Response.json(verdict);
  } catch (err) {
    if (err instanceof LlmError) {
      return apiError(err.code === 'config' ? 500 : 502, 'llm_failed', err.message, { code: err.code });
    }
    throw err;
  }
}
