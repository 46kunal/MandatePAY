/**
 * Shared contracts. OWNER: orchestrator.
 *
 * Everyone codes against these types. Do not change a schema without telling
 * the orchestrator: A (PayPal), B (AI/core) and C (UI/data) all depend on it.
 *
 * Money rules (MVP):
 *  - Amounts are strings with exactly two decimals, e.g. "110.00" (what PayPal expects).
 *  - Zero-decimal currencies (JPY, HUF, TWD) are not supported.
 *  - Inside the database, totals are stored as integer minor units (cents/pence).
 *
 * Mandate naming follows the current AP2 spec: Checkout Mandate (open, then closed)
 * and Payment Mandate. Our JWS format is AP2-shaped, not AP2-interoperable.
 */
import { z } from 'zod';

// ---------- primitives ----------

export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. GBP');
export const Amount = z.string().regex(/^\d+\.\d{2}$/, 'exactly two decimals, e.g. 110.00');
export const IsoDateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO date or datetime');

export const Money = z.object({ value: Amount, currency: CurrencyCode });
export type Money = z.infer<typeof Money>;

// ---------- mandate ----------

/** What the buyer authorises the agent to buy. Validated by B, signed on buyer confirmation. */
export const Constraints = z
  .object({
    max_total: Money,
    categories: z.array(z.string().min(1)).optional(),
    max_quantity: z.number().int().positive().optional(),
    /** Every cart item must match these (case-insensitive), e.g. { color: "white", size: "10" } */
    required_attributes: z.record(z.string(), z.string()).optional(),
    /** Latest acceptable delivery date */
    deadline: IsoDateTime.optional(),
    /** Carts above this total need an explicit buyer click */
    require_approval_over: Amount.optional(),
    /** The buyer's original words, kept as dispute evidence */
    request_text: z.string().max(1000).optional(),
  })
  .strict();
export type Constraints = z.infer<typeof Constraints>;

/** Signed by the buyer key. Payload of the JWS stored in mandates.jws. */
export const OpenMandatePayload = z.object({
  typ: z.literal('checkout_mandate.open'),
  mandate_id: z.string(),
  buyer_ref: z.string(),
  constraints: Constraints,
  iat: z.number().int(), // unix seconds
  exp: z.number().int(), // unix seconds
});
export type OpenMandatePayload = z.infer<typeof OpenMandatePayload>;

/** Binds one specific cart to the open mandate. Signed by buyer (if they approved) or agent. */
export const ClosedMandatePayload = z.object({
  typ: z.literal('checkout_mandate.closed'),
  mandate_id: z.string(),
  open_mandate_hash: z.string(), // "sha256:<hex>"
  cart_hash: z.string(), // "sha256:<hex>"
  total: Amount,
  currency: CurrencyCode,
  approved_by: z.enum(['buyer', 'agent']),
  iat: z.number().int(),
});
export type ClosedMandatePayload = z.infer<typeof ClosedMandatePayload>;

// ---------- cart + guard ----------

export const CartItem = z.object({
  sku: z.string().min(1),
  name: z.string().min(1).max(127),
  category: z.string().optional(),
  quantity: z.number().int().positive().max(1000),
  unit_price: Amount,
  attributes: z.record(z.string(), z.string()).optional(),
});
export type CartItem = z.infer<typeof CartItem>;

export const Cart = z.object({
  currency: CurrencyCode,
  items: z.array(CartItem).min(1),
  /** Estimated delivery date from the merchant listing */
  delivery_eta: IsoDateTime.nullish(),
  merchant: z.string().nullish(),
});
export type Cart = z.infer<typeof Cart>;

export const GuardCheck = z.object({
  rule: z.string(), // e.g. "max_total", "required_attributes", "deadline"
  status: z.enum(['pass', 'fail', 'unsure', 'escalate']),
  detail: z.string(),
});
export type GuardCheck = z.infer<typeof GuardCheck>;

/**
 * allow    = every check passed
 * block    = at least one check failed (HTTP 422, no PayPal order is created)
 * escalate = nothing failed but a check was unsure/over threshold: buyer must approve
 */
export const GuardResult = z.object({
  verdict: z.enum(['allow', 'block', 'escalate']),
  checks: z.array(GuardCheck),
  total: Amount,
  currency: CurrencyCode,
});
export type GuardResult = z.infer<typeof GuardResult>;

// ---------- disputes + analyst ----------

/** Actions the analyst may choose. PayPal decides which are allowed for a given dispute. */
export const ActionType = z.enum([
  'PROVIDE_EVIDENCE',
  'MAKE_OFFER',
  'ACCEPT_CLAIM',
  'SEND_MESSAGE',
  'NO_ACTION',
]);
export type ActionType = z.infer<typeof ActionType>;

export const OfferType = z.enum([
  'REFUND',
  'REFUND_WITH_RETURN',
  'REFUND_WITH_REPLACEMENT',
  'REPLACEMENT_WITHOUT_REFUND',
]);
export type OfferType = z.infer<typeof OfferType>;

/**
 * What A hands to B's analyst. A derives allowed_actions/offer_types from PayPal's
 * allowed_response_options and HATEOAS links in the show-dispute response.
 */
export const DisputeSummary = z.object({
  dispute_id: z.string(),
  reason: z.string(), // PayPal reason code, passed through unchanged
  stage: z.string(), // dispute_life_cycle_stage: INQUIRY, CHARGEBACK, ...
  status: z.string(),
  amount: Money.optional(),
  /** Expected to equal our orders.capture_id. VERIFY IN SANDBOX ON DAY 2 (owner A). */
  seller_transaction_id: z.string().optional(),
  allowed_actions: z.array(ActionType),
  offer_types: z.array(OfferType).default([]),
  messages: z.array(z.object({ from: z.string(), text: z.string(), at: z.string().optional() })).default([]),
  tracking: z.object({ carrier: z.string().optional(), number: z.string().optional(), status: z.string().optional() }).optional(),
});
export type DisputeSummary = z.infer<typeof DisputeSummary>;

/** Output of the case analyst (owner B). Strict: reject anything that does not parse. */
export const Verdict = z.object({
  fault: z.enum(['merchant', 'agent', 'buyer_regret', 'unclear']),
  action: ActionType, // must be in DisputeSummary.allowed_actions
  offer_type: OfferType.optional(),
  offer_amount: Amount.optional(),
  confidence: z.number().min(0).max(1),
  /** Every claim must cite a ledger field, e.g. source: "carts.cart.items[0].attributes.color" */
  evidence_points: z.array(z.object({ claim: z.string(), source: z.string() })),
  reasoning: z.string(),
  /** True when a human must click before the action runs (amount over threshold or low confidence) */
  needs_human: z.boolean(),
});
export type Verdict = z.infer<typeof Verdict>;

export const AnalysisStatus = z.enum(['pending', 'analysed', 'awaiting_human', 'acted', 'error']);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

export const CaseRecord = z.object({
  dispute_id: z.string(),
  capture_id: z.string().nullable(),
  paypal_order_id: z.string().nullable(),
  mandate_id: z.string().nullable(),
  reason: z.string().nullable(),
  stage: z.string().nullable(),
  status: z.string().nullable(),
  amount: Money.nullable(),
  verdict: Verdict.nullable(),
  analysis_status: AnalysisStatus,
  action_taken: z.string().nullable(),
  outcome: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CaseRecord = z.infer<typeof CaseRecord>;

// ---------- API request / response shapes ----------

export const ApiError = z.object({
  error: z.string(), // machine code, e.g. "guard_blocked"
  message: z.string().optional(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const DraftMandateRequest = z.object({ request_text: z.string().min(1).max(1000) });
export const DraftMandateResponse = z.object({
  constraints: Constraints,
  /** Things the model was unsure about; the UI shows them next to the confirm button */
  warnings: z.array(z.string()).default([]),
});

export const CreateMandateRequest = z.object({ buyer_ref: z.string().min(1), constraints: Constraints });
export const CreateMandateResponse = z.object({
  mandate_id: z.string(),
  constraints: Constraints,
  expires_at: IsoDateTime,
});

export const CartCheckRequest = z.object({ mandate_id: z.string(), cart: Cart });
export const CartCheckResponse = GuardResult;

export const PlaceOrderRequest = z.object({
  mandate_id: z.string(),
  cart: Cart,
  /** Must only be true when the buyer clicked approve in the UI */
  buyer_approved: z.boolean().default(false),
});
export const PlaceOrderResponse = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('created'),
    paypal_order_id: z.string(),
    approve_url: z.string().url(),
    cart_id: z.string(),
    guard: GuardResult,
  }),
  z.object({ status: z.literal('needs_approval'), guard: GuardResult }),
]);

export const CaptureOrderResponse = z.object({
  paypal_order_id: z.string(),
  capture_id: z.string(),
  status: z.string(),
});

export const PollDisputesResponse = z.object({
  fetched: z.number().int(),
  new_cases: z.number().int(),
  linked: z.number().int(), // cases matched to one of our orders
});

export const ActOnCaseRequest = z.object({
  /** Required when verdict.needs_human is true */
  human_approved: z.boolean().default(false),
  /** Merchant may override the analyst's action */
  override: z.object({ action: ActionType, offer_type: OfferType.optional(), offer_amount: Amount.optional() }).optional(),
});
