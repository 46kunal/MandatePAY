/**
 * Typed fixtures (owner: C). Shapes come from contracts/schemas.ts so the UI can render with no backend.
 * Scenario: buyer asks an agent for "white trainers, size 10, under 110 USD".
 */
import type { Cart, CaseRecord, Constraints, GuardResult, Verdict } from '../contracts/schemas';

const USD = 'USD';

// ---------- mandate ----------

export const mandateConstraints: Constraints = {
  max_total: { value: '110.00', currency: USD },
  categories: ['shoes'],
  max_quantity: 1,
  required_attributes: { color: 'white', size: '10' },
  deadline: '2026-11-20T23:59:59Z',
  require_approval_over: '100.00',
  request_text: 'Buy me white trainers, size 10, under 110 USD, delivered by Nov 20.',
};

export const mandate = {
  mandate_id: 'mnd_fixture0001',
  buyer_ref: 'buyer_demo',
  constraints: mandateConstraints,
  expires_at: '2026-11-30T00:00:00Z',
};

export const draftWarnings = ['Delivery deadline assumed to be end of day on Nov 20.'];

// ---------- carts ----------

export const cartAllowed: Cart = {
  currency: USD,
  merchant: 'Sole Trader Ltd',
  delivery_eta: '2026-11-15T12:00:00Z',
  items: [
    {
      sku: 'TR-WHT-10',
      name: 'Aero Trainers',
      category: 'shoes',
      quantity: 1,
      unit_price: '89.00',
      attributes: { color: 'white', size: '10' },
    },
  ],
};

export const cartBlocked: Cart = {
  currency: USD,
  merchant: 'Sole Trader Ltd',
  delivery_eta: '2026-11-25T12:00:00Z',
  items: [
    {
      sku: 'TR-BLK-9',
      name: 'Aero Trainers',
      category: 'shoes',
      quantity: 1,
      unit_price: '119.00',
      attributes: { color: 'black', size: '9' },
    },
  ],
};

export const cartNeedsApproval: Cart = {
  currency: USD,
  merchant: 'Sole Trader Ltd',
  delivery_eta: '2026-11-16T12:00:00Z',
  items: [
    {
      sku: 'TR-WHT-10-PRO',
      name: 'Aero Trainers Pro',
      category: 'shoes',
      quantity: 1,
      unit_price: '105.00',
      attributes: { color: 'white', size: '10' },
    },
  ],
};

// ---------- guard results ----------

export const guardAllow: GuardResult = {
  verdict: 'allow',
  total: '89.00',
  currency: USD,
  checks: [
    { rule: 'max_total', status: 'pass', detail: 'Total 89.00 USD is within the 110.00 USD limit.' },
    { rule: 'categories', status: 'pass', detail: 'Category "shoes" is allowed.' },
    { rule: 'max_quantity', status: 'pass', detail: 'Quantity 1 is within the limit of 1.' },
    { rule: 'required_attributes', status: 'pass', detail: 'color=white and size=10 match the mandate.' },
    { rule: 'deadline', status: 'pass', detail: 'Delivery on Nov 15 is before the Nov 20 deadline.' },
    { rule: 'require_approval_over', status: 'pass', detail: 'Total is under the 100.00 approval threshold.' },
  ],
};

export const guardBlock: GuardResult = {
  verdict: 'block',
  total: '119.00',
  currency: USD,
  checks: [
    { rule: 'max_total', status: 'fail', detail: 'Total 119.00 USD exceeds the 110.00 USD limit.' },
    { rule: 'categories', status: 'pass', detail: 'Category "shoes" is allowed.' },
    { rule: 'max_quantity', status: 'pass', detail: 'Quantity 1 is within the limit of 1.' },
    {
      rule: 'required_attributes',
      status: 'fail',
      detail: 'color=black does not match required color=white; size=9 does not match size=10.',
    },
    { rule: 'deadline', status: 'fail', detail: 'Delivery on Nov 25 is after the Nov 20 deadline.' },
    { rule: 'require_approval_over', status: 'escalate', detail: 'Total is over the 100.00 approval threshold.' },
  ],
};

export const guardEscalate: GuardResult = {
  verdict: 'escalate',
  total: '105.00',
  currency: USD,
  checks: [
    { rule: 'max_total', status: 'pass', detail: 'Total 105.00 USD is within the 110.00 USD limit.' },
    { rule: 'categories', status: 'pass', detail: 'Category "shoes" is allowed.' },
    { rule: 'max_quantity', status: 'pass', detail: 'Quantity 1 is within the limit of 1.' },
    { rule: 'required_attributes', status: 'pass', detail: 'color=white and size=10 match the mandate.' },
    { rule: 'deadline', status: 'pass', detail: 'Delivery on Nov 16 is before the Nov 20 deadline.' },
    {
      rule: 'require_approval_over',
      status: 'escalate',
      detail: 'Total 105.00 USD is over the 100.00 approval threshold. Buyer must approve.',
    },
  ],
};

// ---------- verdicts ----------

export const verdictMerchantFault: Verdict = {
  fault: 'merchant',
  action: 'MAKE_OFFER',
  offer_type: 'REFUND',
  offer_amount: '89.00',
  confidence: 0.93,
  needs_human: false,
  reasoning:
    'The buyer asked for white, size 10. The cart matched the mandate, but the merchant shipped black, size 9. The merchant is at fault, so a full refund is fair.',
  evidence_points: [
    { claim: 'Mandate required color=white', source: 'mandates.constraints.required_attributes.color' },
    { claim: 'Cart ordered color=white', source: 'carts.cart.items[0].attributes.color' },
    { claim: 'Buyer reports a black item arrived', source: 'cases.raw_dispute.messages[0]' },
  ],
};

export const verdictAgentError: Verdict = {
  fault: 'agent',
  action: 'ACCEPT_CLAIM',
  confidence: 0.88,
  needs_human: true,
  reasoning:
    'The agent bought black trainers although the mandate required white. The merchant delivered what was ordered, but the cart violated the mandate, so the loss belongs to the agent side.',
  evidence_points: [
    { claim: 'Mandate required color=white', source: 'mandates.constraints.required_attributes.color' },
    { claim: 'Cart contained color=black', source: 'carts.cart.items[0].attributes.color' },
  ],
};

export const verdictBuyerRegret: Verdict = {
  fault: 'buyer_regret',
  action: 'PROVIDE_EVIDENCE',
  confidence: 0.81,
  needs_human: false,
  reasoning:
    'The cart matched the mandate exactly and the item was delivered as listed. The buyer simply changed their mind. The merchant should defend with the signed mandate.',
  evidence_points: [
    { claim: 'Cart matched every mandate rule', source: 'carts.guard.verdict' },
    { claim: 'Carrier shows item delivered', source: 'cases.raw_dispute.tracking.status' },
  ],
};

export const verdictWrongProduct: Verdict = {
  fault: 'unclear',
  action: 'SEND_MESSAGE',
  confidence: 0.46,
  needs_human: true,
  reasoning:
    'The cart is inside the mandate, but the buyer says the product is the wrong model. The mandate only constrains colour and size, so fault cannot be decided without a person.',
  evidence_points: [
    { claim: 'Mandate does not name a model', source: 'mandates.constraints' },
    { claim: 'Buyer says model is wrong', source: 'cases.raw_dispute.messages[0]' },
  ],
};

// ---------- cases ----------

const caseBase = {
  stage: 'INQUIRY',
  status: 'OPEN',
  action_taken: null,
  outcome: null,
  created_at: '2026-11-05T10:00:00Z',
  updated_at: '2026-11-05T10:00:00Z',
} as const;

export const cases: CaseRecord[] = [
  {
    ...caseBase,
    dispute_id: 'PP-D-1001',
    capture_id: 'CAP-1001',
    paypal_order_id: 'ORD-1001',
    mandate_id: mandate.mandate_id,
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    amount: { value: '89.00', currency: USD },
    verdict: verdictMerchantFault,
    analysis_status: 'analysed',
  },
  {
    ...caseBase,
    dispute_id: 'PP-D-1002',
    capture_id: 'CAP-1002',
    paypal_order_id: 'ORD-1002',
    mandate_id: mandate.mandate_id,
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    amount: { value: '119.00', currency: USD },
    verdict: verdictAgentError,
    analysis_status: 'awaiting_human',
  },
  {
    ...caseBase,
    dispute_id: 'PP-D-1003',
    capture_id: 'CAP-1003',
    paypal_order_id: 'ORD-1003',
    mandate_id: mandate.mandate_id,
    reason: 'UNAUTHORISED',
    amount: { value: '89.00', currency: USD },
    verdict: verdictBuyerRegret,
    analysis_status: 'analysed',
  },
  {
    ...caseBase,
    dispute_id: 'PP-D-1004',
    capture_id: 'CAP-1004',
    paypal_order_id: 'ORD-1004',
    mandate_id: mandate.mandate_id,
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    amount: { value: '105.00', currency: USD },
    verdict: verdictWrongProduct,
    analysis_status: 'awaiting_human',
  },
  {
    ...caseBase,
    dispute_id: 'PP-D-1005',
    capture_id: 'CAP-1005',
    paypal_order_id: 'ORD-1005',
    mandate_id: mandate.mandate_id,
    reason: 'ITEM_NOT_RECEIVED',
    amount: { value: '89.00', currency: USD },
    verdict: null,
    analysis_status: 'pending',
  },
];

/** Response of GET /api/cases/:id: CaseRecord plus mandate, cart and order (see contracts/api.md). */
export type CaseDetail = CaseRecord & {
  mandate: typeof mandate | null;
  cart: Cart | null;
  order: { paypal_order_id: string; capture_id: string | null; status: string; receipt_hash: string | null } | null;
};

const cartForCase: Record<string, Cart> = {
  'PP-D-1001': cartAllowed,
  'PP-D-1002': cartBlocked,
  'PP-D-1003': cartAllowed,
  'PP-D-1004': cartNeedsApproval,
  'PP-D-1005': cartAllowed,
};

export function caseDetail(id: string): CaseDetail | undefined {
  const record = cases.find((c) => c.dispute_id === id);
  if (!record) return undefined;
  return {
    ...record,
    mandate,
    cart: cartForCase[id] ?? null,
    order: record.paypal_order_id
      ? {
          paypal_order_id: record.paypal_order_id,
          capture_id: record.capture_id,
          status: 'COMPLETED',
          receipt_hash: 'sha256:fixture' + id.toLowerCase(),
        }
      : null,
  };
}

// ---------- API response fixtures ----------

export const placeOrderCreated = {
  status: 'created' as const,
  paypal_order_id: 'ORD-FIXTURE',
  approve_url: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD-FIXTURE',
  cart_id: 'cart_fixture0001',
  guard: guardAllow,
};

export const placeOrderNeedsApproval = { status: 'needs_approval' as const, guard: guardEscalate };

export const captureResponse = { paypal_order_id: 'ORD-FIXTURE', capture_id: 'CAP-FIXTURE', status: 'COMPLETED' };

export const pollResponse = { fetched: 5, new_cases: 0, linked: 5 };
