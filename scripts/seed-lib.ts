// OWNER: C. Demo data: four dispute scenarios built with the real signing, guard and receipt-hash code,
// so everything the UI and the analyst read is internally consistent. Used by scripts/seed.ts and POST /api/demo/reset.
import { db, schema } from '../db/client';
import type { Cart, Constraints, Verdict } from '../contracts/schemas';
import { signOpenMandate } from '../lib/mandate/jws';
import { createClosedMandate, computeReceiptHash, hashCart } from '../lib/mandate/closed';
import { evaluateCart } from '../lib/mandate/guard';
import { cartTotalMinor, toMinor } from '../lib/mandate/money';

const DAY = 24 * 60 * 60;
const BUYER_REF = 'buyer_demo';

export interface SeedSummary {
  mandates: number;
  carts: number;
  orders: number;
  cases: number;
}

interface Scenario {
  key: 'merchant_fault' | 'agent_error' | 'buyer_regret' | 'wrong_product';
  title: string;
  requestText: string;
  constraints: Constraints;
  cart: Cart;
  /** Who approved the cart: the agent alone, or the buyer after an approval prompt. */
  approvedBy: 'agent' | 'buyer';
  reason: string;
  buyerMessage: string;
  verdict: Verdict;
  analysisStatus: 'analysed' | 'awaiting_human';
}

export function buildScenarios(nowSec: number): Scenario[] {
  const deadline = new Date((nowSec + 14 * DAY) * 1000).toISOString();
  const eta = new Date((nowSec + 5 * DAY) * 1000).toISOString();
  const trainersMandate = (text: string): Constraints => ({
    max_total: { value: '110.00', currency: 'GBP' },
    categories: ['shoes'],
    max_quantity: 1,
    required_attributes: { color: 'white', size: '10' },
    deadline,
    require_approval_over: '100.00',
    request_text: text,
  });
  const cart = (sku: string, name: string, price: string, attributes: Record<string, string>): Cart => ({
    currency: 'GBP',
    merchant: 'Sole Trader Ltd',
    delivery_eta: eta,
    items: [{ sku, name, category: 'shoes', quantity: 1, unit_price: price, attributes }],
  });

  return [
    {
      key: 'merchant_fault',
      title: 'Merchant at fault',
      requestText: 'Buy me white trainers, size 10, under 110 GBP.',
      constraints: trainersMandate('Buy me white trainers, size 10, under 110 GBP.'),
      cart: cart('TR-WHT-10', 'Aero Running Trainers', '89.00', { color: 'white', size: '10' }),
      approvedBy: 'agent',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      buyerMessage: 'I ordered white trainers in size 10 but a black pair in size 9 arrived.',
      analysisStatus: 'analysed',
      verdict: {
        fault: 'merchant',
        action: 'MAKE_OFFER',
        offer_type: 'REFUND',
        offer_amount: '89.00',
        confidence: 0.93,
        needs_human: false,
        reasoning:
          'The signed mandate and the cart both say white, size 10, and the cart passed every guard rule. The buyer reports a black size 9 pair arrived, so the merchant shipped something other than the cart. A full refund is fair.',
        evidence_points: [
          { claim: 'The mandate required white.', source: 'mandate.constraints.required_attributes.color' },
          { claim: 'The cart ordered white.', source: 'cart.items[0].attributes.color' },
          { claim: 'The buyer reports a different item arrived.', source: 'dispute.messages[0].text' },
        ],
      },
    },
    {
      key: 'agent_error',
      title: 'Agent error',
      requestText: 'Get me white trainers in size 10 for under 110 GBP, ask me if you are unsure.',
      constraints: trainersMandate('Get me white trainers in size 10 for under 110 GBP, ask me if you are unsure.'),
      // The listing has no size, so the guard cannot confirm size 10 ("unsure"). The agent should have checked.
      cart: cart('TR-WHT-ANY', 'Aero Trainers (size not listed)', '89.00', { color: 'white' }),
      approvedBy: 'buyer',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      buyerMessage: 'The trainers are white but they are size 9, not size 10.',
      analysisStatus: 'awaiting_human',
      verdict: {
        fault: 'agent',
        action: 'MAKE_OFFER',
        offer_type: 'REFUND_WITH_RETURN',
        offer_amount: '89.00',
        confidence: 0.84,
        needs_human: true,
        reasoning:
          'The listing never stated a size, so the guard could not confirm the mandate\'s size 10 requirement. The merchant sent what was listed. The agent bought without confirming the size, so a refund with return is a fair split.',
        evidence_points: [
          { claim: 'The mandate required size 10.', source: 'mandate.constraints.required_attributes.size' },
          { claim: 'The cart listing has no size attribute.', source: 'cart.items[0].attributes' },
          { claim: 'The buyer received size 9.', source: 'dispute.messages[0].text' },
        ],
      },
    },
    {
      key: 'buyer_regret',
      title: 'Buyer regret',
      requestText: 'Buy me white trainers, size 10, under 110 GBP.',
      constraints: trainersMandate('Buy me white trainers, size 10, under 110 GBP.'),
      cart: cart('TR-WHT-10', 'Aero Running Trainers', '89.00', { color: 'white', size: '10' }),
      approvedBy: 'agent',
      reason: 'UNAUTHORISED',
      buyerMessage: 'I do not want these any more, please send my money back.',
      analysisStatus: 'analysed',
      verdict: {
        fault: 'buyer_regret',
        action: 'PROVIDE_EVIDENCE',
        confidence: 0.82,
        needs_human: false,
        reasoning:
          'The buyer signed a mandate for exactly this item and price, and the cart passed every rule. The message only says they changed their mind. The merchant should defend with the signed mandate.',
        evidence_points: [
          { claim: 'The purchase was made under a mandate the buyer signed.', source: 'mandate.mandate_id' },
          { claim: 'The mandate allowed up to 110.00.', source: 'mandate.constraints.max_total.value' },
          { claim: 'The buyer says they no longer want the item.', source: 'dispute.messages[0].text' },
        ],
      },
    },
    {
      key: 'wrong_product',
      title: 'Within mandate, wrong product',
      requestText: 'Buy me white trainers, size 10, under 110 GBP.',
      constraints: trainersMandate('Buy me white trainers, size 10, under 110 GBP.'),
      // Fits every rule, but the agent chose slippers, not running trainers.
      cart: cart('SL-WHT-10', 'Aero Indoor Slippers', '95.00', { color: 'white', size: '10' }),
      approvedBy: 'agent',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      buyerMessage: 'These are indoor slippers, I wanted running trainers.',
      analysisStatus: 'awaiting_human',
      verdict: {
        fault: 'unclear',
        action: 'SEND_MESSAGE',
        confidence: 0.48,
        needs_human: true,
        reasoning:
          'The cart is inside the mandate, which only fixes colour, size, category and price. The mandate does not say running trainers, so the agent technically complied, but the buyer clearly wanted something else. A person should decide.',
        evidence_points: [
          { claim: 'The mandate only constrains colour, size, category and price.', source: 'mandate.constraints.required_attributes' },
          { claim: 'The cart item is a slipper.', source: 'cart.items[0].name' },
          { claim: 'The buyer wanted running trainers.', source: 'dispute.messages[0].text' },
        ],
      },
    },
  ];
}

/** Build the PayPal-shaped raw dispute we store, mirroring what lib/paypal/disputes.ts reads. */
function rawDispute(id: string, s: Scenario, captureId: string, createdAt: Date) {
  const total = cartTotalMinor(s.cart);
  return {
    dispute_id: id,
    reason: s.reason,
    status: 'OPEN',
    dispute_life_cycle_stage: 'INQUIRY',
    dispute_amount: { currency_code: s.cart.currency, value: (total / 100).toFixed(2) },
    disputed_transactions: [{ seller_transaction_id: captureId }],
    messages: [{ posted_by: 'BUYER', content: s.buyerMessage, time_posted: createdAt.toISOString() }],
    allowed_response_options: {
      make_offer: { offer_types: ['REFUND', 'REFUND_WITH_RETURN', 'REFUND_WITH_REPLACEMENT'] },
      provide_evidence: {},
      send_message: {},
      accept_claim: {},
    },
    create_time: createdAt.toISOString(),
    update_time: createdAt.toISOString(),
    _seeded: true,
  } satisfies Record<string, unknown>;
}

/** Wipe all app tables and insert the demo scenarios. Runs in one transaction. */
export async function seedDemo(): Promise<SeedSummary> {
  const nowSec = Math.floor(Date.now() / 1000);
  const scenarios = buildScenarios(nowSec);
  const summary: SeedSummary = { mandates: 0, carts: 0, orders: 0, cases: 0 };

  // Sign everything first so a signing failure never leaves the database half-wiped.
  const prepared = await Promise.all(
    scenarios.map(async (s, i) => {
      const n = String(i + 1).padStart(4, '0');
      const mandateId = `mnd_seed${n}`;
      const cartId = `cart_seed${n}`;
      const orderId = `SEED-ORD-${n}`;
      const captureId = `SEED-CAP-${n}`;
      const disputeId = `PP-D-SEED-${n}`;
      const exp = nowSec + 7 * DAY;
      const mandateJws = await signOpenMandate({
        typ: 'checkout_mandate.open',
        mandate_id: mandateId,
        buyer_ref: BUYER_REF,
        constraints: s.constraints,
        iat: nowSec,
        exp,
      });
      const closed = await createClosedMandate({
        mandateId,
        openMandateJws: mandateJws,
        cart: s.cart,
        approvedBy: s.approvedBy,
        now: nowSec,
      });
      const cartHash = hashCart(s.cart);
      const receiptHash = computeReceiptHash({ mandateId, cartId, cartHash, paypalOrderId: orderId, captureId });
      const guard = evaluateCart(s.constraints, s.cart);
      // Cases are listed newest first in the UI: stagger them by a few hours.
      const createdAt = new Date((nowSec - (scenarios.length - i) * 4 * 3600) * 1000);
      return { s, mandateId, cartId, orderId, captureId, disputeId, mandateJws, closed, cartHash, receiptHash, guard, createdAt, exp };
    }),
  );

  await db.transaction(async (tx) => {
    // Child tables first (foreign keys).
    await tx.delete(schema.events);
    await tx.delete(schema.cases);
    await tx.delete(schema.orders);
    await tx.delete(schema.carts);
    await tx.delete(schema.mandates);

    for (const p of prepared) {
      await tx.insert(schema.mandates).values({
        mandateId: p.mandateId,
        buyerRef: BUYER_REF,
        requestText: p.s.requestText,
        constraints: p.s.constraints,
        jws: p.mandateJws,
        expiresAt: new Date(p.exp * 1000),
        createdAt: p.createdAt,
      });
      summary.mandates++;

      await tx.insert(schema.carts).values({
        cartId: p.cartId,
        mandateId: p.mandateId,
        cart: p.s.cart,
        cartHash: p.cartHash,
        totalMinor: cartTotalMinor(p.s.cart),
        currency: p.s.cart.currency,
        guard: p.guard,
        closedMandateJws: p.closed.jws,
        approvedBy: p.s.approvedBy,
        createdAt: p.createdAt,
      });
      summary.carts++;

      await tx.insert(schema.orders).values({
        paypalOrderId: p.orderId,
        cartId: p.cartId,
        mandateId: p.mandateId,
        status: 'COMPLETED',
        approveUrl: null,
        captureId: p.captureId,
        receiptHash: p.receiptHash,
        createdAt: p.createdAt,
        capturedAt: p.createdAt,
      });
      summary.orders++;

      const disputedAt = new Date(p.createdAt.getTime() + 2 * 3600 * 1000);
      await tx.insert(schema.cases).values({
        disputeId: p.disputeId,
        captureId: p.captureId,
        paypalOrderId: p.orderId,
        mandateId: p.mandateId,
        reason: p.s.reason,
        stage: 'INQUIRY',
        status: 'OPEN',
        amountMinor: toMinor(p.guard.total),
        currency: p.guard.currency,
        rawDispute: rawDispute(p.disputeId, p.s, p.captureId, disputedAt),
        verdict: p.s.verdict,
        analysisStatus: p.s.analysisStatus,
        createdAt: disputedAt,
        updatedAt: disputedAt,
      });
      summary.cases++;
    }
  });

  return summary;
}

