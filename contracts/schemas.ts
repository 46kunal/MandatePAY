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

export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. USD');
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
  /** Who PayPal is waiting on and the deadline (seller_response_due_date / buyer_response_due_date). */
  response_due: z.object({ party: z.enum(['seller', 'buyer']), at: z.string() }).optional(),
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
  /** Who PayPal is waiting on and until when; null when nothing is due. */
  response_due: z.object({ party: z.enum(['seller', 'buyer']), at: z.string() }).nullable(),
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

// buyer_ref is ignored if sent: the mandate is signed for the signed-in user (their user id becomes buyer_ref).
export const CreateMandateRequest = z.object({ buyer_ref: z.string().optional(), constraints: Constraints });
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
  /** paypal (default): approve in PayPal's window. card: the order is paid with PayPal's hosted card fields. */
  funding: z.enum(['paypal', 'card']).default('paypal'),
});
export const PlaceOrderResponse = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('created'),
    paypal_order_id: z.string(),
    approve_url: z.string().url().optional(), // absent for funding "card"
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

/** One row of GET /api/orders: an order placed through MandatePay, its payment state and any dispute on it. */
export const OrderSummary = z.object({
  paypal_order_id: z.string(),
  cart_id: z.string(),
  mandate_id: z.string(),
  status: z.string(), // PayPal order status, e.g. PAYER_ACTION_REQUIRED, APPROVED, COMPLETED
  total: Amount,
  currency: z.string().length(3),
  items: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
  capture_id: z.string().optional(),
  receipt_hash: z.string().optional(),
  created_at: z.string(),
  captured_at: z.string().optional(),
  dispute_id: z.string().optional(),
  /** Total refunded on this payment (also refunds made in the PayPal dashboard), as last read from PayPal. */
  refunded: Amount.optional(),
  /** A refund is still pending at PayPal. */
  refund_pending: z.boolean().optional(),
});
export type OrderSummary = z.infer<typeof OrderSummary>;

/** Refund all (amount omitted) or part of a captured order. The key makes a repeated click safe: same key, one refund. */
export const RefundOrderRequest = z
  .object({
    amount: Amount.optional(),
    note: z.string().trim().max(255).optional(),
    idempotency_key: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  })
  .strict();
export const RefundOrderResponse = z.object({
  refund_id: z.string(),
  status: z.string(), // PayPal refund status: COMPLETED, PENDING, ...
  amount: Amount,
  currency: z.string(),
  refunded_total: Amount, // all refunds on the payment, this one included
  remaining: Amount, // what can still be refunded
});

export const ListOrdersResponse = z.object({ orders: z.array(OrderSummary) });

// ---------- accounts, team, admin, audit (Phase 2) ----------

export const RoleName = z.enum(['buyer', 'staff', 'owner', 'admin']);

/** One person's account as the store team and admins see it. Never includes password data. */
export const AccountSummary = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: RoleName,
  disabled: z.boolean(),
  created_at: z.string(),
});
export type AccountSummary = z.infer<typeof AccountSummary>;

export const ListTeamResponse = z.object({ members: z.array(AccountSummary) });
/** Give an existing account a role. The person signs up at /login first. */
export const SetTeamRoleRequest = z.object({ email: z.string().email(), role: RoleName }).strict();

export const ListUsersResponse = z.object({ users: z.array(AccountSummary) });
export const UpdateUserRequest = z
  .object({ role: RoleName.optional(), disabled: z.boolean().optional() })
  .strict()
  .refine((v) => v.role !== undefined || v.disabled !== undefined, 'Send role or disabled.');

export const AuditRecord = z.object({
  id: z.string(),
  at: z.string(),
  actor_email: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
});
export const ListAuditResponse = z.object({ entries: z.array(AuditRecord) });

export const HealthCheck = z.object({ name: z.string(), ok: z.boolean(), detail: z.string() });
export const SystemHealth = z.object({ checked_at: z.string(), checks: z.array(HealthCheck) });

/** A buyer's own mandate, for their account page. */
export const MyMandate = z.object({
  mandate_id: z.string(),
  request_text: z.string().nullable(),
  max_total: Money,
  status: z.enum(['active', 'expired', 'revoked']),
  created_at: z.string(),
  expires_at: z.string(),
  revoked_at: z.string().nullable(),
  orders: z.number().int(),
});
export type MyMandate = z.infer<typeof MyMandate>;
export const ListMyMandatesResponse = z.object({ mandates: z.array(MyMandate) });

// ---------- store settings ----------

/** Settings the store owner edits in the app. Secrets are not settings: they stay in environment variables. */
export const StoreSettings = z.object({
  store_name: z.string().min(1).max(80).nullable(), // shown on carts, evidence and receipts
  support_email: z.string().email().max(200).nullable(),
  approval_threshold: Amount, // carts above this need the buyer's click, unless the mandate sets its own limit
  human_review_over: Amount, // disputes at or above this always need a person
  min_confidence: z.number().min(0).max(1), // AI verdicts below this need a person
  auto_analyse: z.boolean(), // analyse new disputes as soon as they arrive (webhook or poll)
  updated_at: z.string().nullable(), // null while every value is still the default
});
export type StoreSettings = z.infer<typeof StoreSettings>;

export const UpdateStoreSettingsRequest = StoreSettings.omit({ updated_at: true }).partial().strict();
export type UpdateStoreSettingsRequest = z.infer<typeof UpdateStoreSettingsRequest>;

/** Optional body of POST /api/disputes/poll: fetch one dispute by id (PayPal's list can lag behind for new disputes). */
export const PollDisputesRequest = z
  .object({ dispute_id: z.string().regex(/^PP-[A-Z0-9-]{4,60}$/, 'a PayPal dispute id like PP-R-ABC-12345678') })
  .strict();

export const PollDisputesResponse = z.object({
  fetched: z.number().int(),
  new_cases: z.number().int(),
  linked: z.number().int(), // cases matched to one of our orders
});

// ---------- merchant catalog + shopping agent ----------

/** What a merchant enters for one product. Prices are strings with two decimals, like every amount here. */
export const ProductInput = z
  .object({
    sku: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(127),
    description: z.string().max(1000).optional(),
    category: z.string().trim().min(1).max(64),
    unit_price: Amount,
    currency: CurrencyCode,
    /** e.g. { color: "white", size: "10" }; the guard compares these with the mandate's required_attributes */
    attributes: z.record(z.string(), z.string()).default({}),
    stock: z.number().int().min(0),
    /** Working days from order to delivery; becomes the cart's delivery_eta */
    delivery_days: z.number().int().min(0).max(365),
    /** A picture of the product shown to buyers. https only. */
    image_url: z.string().trim().max(500).url().refine((v) => v.startsWith('https://'), 'Use an https:// link').optional(),
  })
  .strict();
export type ProductInput = z.infer<typeof ProductInput>;

export const Product = ProductInput.extend({
  product_id: z.string(),
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Product = z.infer<typeof Product>;

/** PATCH body: any subset of the input fields, plus active to hide a product from the agent. */
export const UpdateProductRequest = ProductInput.partial().extend({ active: z.boolean().optional() }).strict();

export const AgentShopRequest = z.object({ mandate_id: z.string() });

/** One product the agent chose and why. */
export const AgentPick = z.object({
  sku: z.string(),
  quantity: z.number().int().positive(),
  reason: z.string(),
});
export type AgentPick = z.infer<typeof AgentPick>;

/** The agent's proposal: a cart built from the catalog (prices from the database, never from the model), checked by the guard. */
export const AgentShopResponse = z.object({
  cart: Cart,
  picks: z.array(AgentPick),
  summary: z.string(),
  guard: GuardResult,
  /** How many in-stock products in the mandate's currency the agent could choose from */
  considered: z.number().int(),
});

export const ActOnCaseRequest = z.object({
  /** Required when verdict.needs_human is true */
  human_approved: z.boolean().default(false),
  /** Merchant may override the analyst's action */
  override: z.object({ action: ActionType, offer_type: OfferType.optional(), offer_amount: Amount.optional() }).optional(),
  /** The person saw that the buyer was already refunded and still wants to offer or accept (else 409 already_refunded). */
  confirm_refunded: z.boolean().default(false),
});

// ---------- buyer problem reports (before a PayPal dispute) ----------

export const ProblemKind = z.enum(['agent_mistake', 'not_received', 'damaged', 'other']);
export type ProblemKind = z.infer<typeof ProblemKind>;

/**
 * Computed from the stored records when the report is made, never from the buyer's text.
 * agent_mistake = the cart guard did not pass every check at checkout (an item or price the mandate did not clearly
 * cover went through), so the agent bought outside what was signed. suggestion is what the store should do.
 */
export const ReportAssessment = z.object({
  agent_mistake: z.boolean(),
  suggestion: z.enum(['refund', 'review']),
  summary: z.string(),
  checks: z.array(GuardCheck), // the guard checks that did not pass (empty when all passed)
});
export type ReportAssessment = z.infer<typeof ReportAssessment>;

export const ReportStatus = z.enum(['open', 'refunded', 'closed']);
export type ReportStatus = z.infer<typeof ReportStatus>;

export const ProblemReport = z.object({
  report_id: z.string(),
  paypal_order_id: z.string(),
  kind: ProblemKind,
  message: z.string(),
  assessment: ReportAssessment,
  status: ReportStatus,
  reply: z.string().nullable(),
  refund: Money.nullable(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  /** Merchant views only */
  buyer_email: z.string().optional(),
  order_total: Money.optional(),
  items: z.array(z.string()).optional(),
});
export type ProblemReport = z.infer<typeof ProblemReport>;

export const CreateReportRequest = z
  .object({
    kind: ProblemKind,
    message: z.string().trim().min(5).max(1000),
  })
  .strict();

/** refund: send money back through PayPal (amount omitted = all still refundable). close: reply only. */
export const ResolveReportRequest = z
  .object({
    outcome: z.enum(['refund', 'close']),
    reply: z.string().trim().min(2).max(1000),
    amount: Amount.optional(),
    idempotency_key: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  })
  .strict();

/** One of the buyer's own paid orders, for "Report a problem". */
export const MyOrder = z.object({
  paypal_order_id: z.string(),
  items: z.array(z.string()),
  total: Money,
  status: z.string(),
  paid_at: z.string().nullable(),
  refunded: Amount.nullable(),
  seller: z.string(), // the store's name
  images: z.array(z.string()), // picture links for the items, where the store added them
  report: ProblemReport.nullable(), // the latest report on this order
});
export type MyOrder = z.infer<typeof MyOrder>;

// ---------- results (demo page) ----------

export const ResultsResponse = z.object({
  generated_at: z.string(),
  disputes: z.object({
    total: z.number().int(),
    analysed: z.number().int(), // the AI gave a recommendation
    responded: z.number().int(), // a response was sent to PayPal
    resolved: z.number().int(), // PayPal closed it
    store_won: z.number().int(),
    buyer_won: z.number().int(),
  }),
  people: z.object({
    responses: z.number().int(), // responses sent through MandatePay
    followed_ai: z.number().int(), // sent what the AI recommended
    changed_ai: z.number().int(), // a person chose something else
    approved_by_person: z.number().int(), // the AI asked for a person and one approved
  }),
  speed: z.object({
    median_minutes_to_response: z.number().nullable(), // dispute arrived -> response sent
    est_minutes_saved: z.number(), // analysed disputes x manual minutes per dispute (an estimate)
    manual_minutes_per_dispute: z.number(), // the assumption behind est_minutes_saved
  }),
  guard: z.object({
    carts_checked: z.number().int(),
    allowed: z.number().int(),
    needed_approval: z.number().int(),
    blocked: z.number().int(),
    blocked_value: Money.nullable(), // money the guard stopped from being spent outside a mandate
    orders_paid: z.number().int(),
  }),
  reports: z.object({
    total: z.number().int(),
    open: z.number().int(),
    refunded: z.number().int(), // settled with a refund, no PayPal dispute needed
    closed: z.number().int(),
    agent_mistakes: z.number().int(),
  }),
  refunds: z.object({ count: z.number().int(), total: Money.nullable() }),
  /** The analyst on the labelled test set (eval/results.json, written by npm run eval) */
  eval: z
    .object({
      run_at: z.string(),
      provider: z.string(),
      cases: z.number().int(),
      fault: z.number(),
      action: z.number(),
      needs_human: z.number(),
      overall: z.number(),
    })
    .nullable(),
});
export type ResultsResponse = z.infer<typeof ResultsResponse>;

export const ListMyOrdersResponse = z.object({ orders: z.array(MyOrder) });
export const ListReportsResponse = z.object({ reports: z.array(ProblemReport) });
export const ResolveReportResponse = z.object({
  report_id: z.string(),
  status: ReportStatus,
  refund: RefundOrderResponse.optional(),
});

// ---------- what a buyer sees of the store ----------

/**
 * One product as a buyer sees it. There is no stock count and no store-only field: availability is a word, and
 * max_quantity is the most a buyer can add in one order.
 */
export const BuyerProduct = z.object({
  sku: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string(),
  unit_price: Amount,
  currency: CurrencyCode,
  attributes: z.record(z.string(), z.string()),
  delivery_days: z.number().int(),
  image_url: z.string().optional(),
  availability: z.enum(['in_stock', 'low_stock']),
  max_quantity: z.number().int().positive(),
});
export type BuyerProduct = z.infer<typeof BuyerProduct>;

export const ShopCatalogResponse = z.object({
  seller: z.string(), // the store's name
  products: z.array(BuyerProduct),
});
