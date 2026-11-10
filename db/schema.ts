/**
 * Database schema (Postgres via Drizzle). OWNER: C implements and migrates; orchestrator approves changes.
 * Column shapes mirror contracts/schemas.ts. Totals are integer minor units.
 */
import { bigint, boolean, index, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import type { Cart, Constraints, GuardResult, ReportAssessment, Verdict } from '../contracts/schemas';

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------- accounts and sign-in (Better Auth; field names are the ones it expects) ----------

/** People who sign in. role: buyer | staff | owner | admin (see lib/auth/roles.ts). Never set from sign-up input. */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('buyer'),
  disabledAt: ts('disabled_at'), // set by an admin: the person cannot sign in and existing sessions stop working
  // The PayPal account linked with "Log in with PayPal" / "Connect PayPal". payer_id is the id PayPal puts on
  // the orders this account pays, so a payment can be matched to the signed-in buyer.
  paypalPayerId: text('paypal_payer_id').unique(),
  paypalVerified: boolean('paypal_verified'),
  paypalLinkedAt: ts('paypal_linked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/** Sign-in methods per user. For email sign-in, `password` holds the password hash (never the password). */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
);

/** One-time tokens (email verification, password reset). */
export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Sign-in rate limits, stored in the database so they hold across serverless instances. */
export const rateLimits = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

/**
 * Each buyer's own mandate signing key (Ed25519). The public key is stored as is, so anyone verifying a mandate can
 * check it; the private key is encrypted (AES-256-GCM) with MANDATE_KEY_ENCRYPTION_KEY and never leaves the server.
 * kid goes in the mandate's JWS header, so a signature names the exact key, and through it the buyer, that signed.
 */
export const buyerKeys = pgTable('buyer_keys', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  kid: text('kid').notNull().unique(),
  publicKeyPem: text('public_key_pem').notNull(),
  privateKeyEnc: text('private_key_enc').notNull(), // "v1.<iv>.<tag>.<ciphertext>", base64url parts
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** One row per confirmed open (checkout) mandate. */
export const mandates = pgTable('mandates', {
  mandateId: text('mandate_id').primaryKey(), // "mnd_<hex>", also stored in PayPal custom_id
  // The buyer who signed it. Carts and orders belong to a buyer through their mandate.
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  buyerRef: text('buyer_ref').notNull(),
  requestText: text('request_text'),
  constraints: jsonb('constraints').$type<Constraints>().notNull(),
  jws: text('jws').notNull(), // signed OpenMandatePayload
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'), // set when the buyer withdraws it: no new carts or orders after this
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** The merchant's catalog. The shopping agent may only buy products listed here, at these prices. */
export const products = pgTable('products', {
  productId: text('product_id').primaryKey(), // "prd_<hex>"
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  unitPriceMinor: integer('unit_price_minor').notNull(),
  currency: text('currency').notNull(),
  attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default({}),
  stock: integer('stock').notNull(),
  deliveryDays: integer('delivery_days').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Every cart the guard evaluated, including blocked ones (useful for the demo and for evidence). */
export const carts = pgTable('carts', {
  cartId: text('cart_id').primaryKey(), // "cart_<hex>", used as PayPal invoice_id
  mandateId: text('mandate_id')
    .notNull()
    .references(() => mandates.mandateId),
  cart: jsonb('cart').$type<Cart>().notNull(),
  cartHash: text('cart_hash').notNull(), // sha256 of canonical JSON
  totalMinor: integer('total_minor').notNull(),
  currency: text('currency').notNull(),
  guard: jsonb('guard').$type<GuardResult>().notNull(),
  closedMandateJws: text('closed_mandate_jws'), // null if blocked or awaiting approval
  approvedBy: text('approved_by'), // 'buyer' | 'agent'
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** PayPal orders we created. capture_id is the join key for disputes. */
export const orders = pgTable('orders', {
  paypalOrderId: text('paypal_order_id').primaryKey(),
  cartId: text('cart_id')
    .notNull()
    .references(() => carts.cartId),
  mandateId: text('mandate_id')
    .notNull()
    .references(() => mandates.mandateId),
  status: text('status').notNull(), // PayPal order status
  approveUrl: text('approve_url'),
  captureId: text('capture_id').unique(),
  receiptHash: text('receipt_hash'), // sha256 over mandate + cart + order + capture ids
  // Refunds on this payment as PayPal reports them (including ones made in the PayPal dashboard, outside MandatePay).
  // A snapshot, refreshed from PayPal when a dispute is read, analysed or acted on. See lib/paypal/refunds.ts.
  refunds: jsonb('refunds').$type<{ id: string; status: string; amount_minor: number; currency: string; created_at: string | null }[]>().notNull().default([]),
  refundsCheckedAt: ts('refunds_checked_at'),
  payerId: text('payer_id'), // the PayPal payer who paid (from the capture), compared with the buyer's linked account
  paymentSource: text('payment_source'), // 'paypal' (a PayPal account) or 'card' (guest card checkout)
  createdAt: ts('created_at').notNull().defaultNow(),
  capturedAt: ts('captured_at'),
});

/** One row per PayPal dispute we know about. */
export const cases = pgTable('cases', {
  disputeId: text('dispute_id').primaryKey(),
  captureId: text('capture_id'), // from dispute.disputed_transactions[].seller_transaction_id (verify!)
  paypalOrderId: text('paypal_order_id'),
  mandateId: text('mandate_id'),
  reason: text('reason'),
  stage: text('stage'),
  status: text('status'),
  amountMinor: integer('amount_minor'),
  currency: text('currency'),
  rawDispute: jsonb('raw_dispute').$type<Record<string, unknown>>(),
  verdict: jsonb('verdict').$type<Verdict>(),
  analysisStatus: text('analysis_status').notNull().default('pending'), // see AnalysisStatus
  actionTaken: text('action_taken'),
  outcome: text('outcome'),
  humanApprovedAt: ts('human_approved_at'),
  actedBy: text('acted_by').references(() => users.id), // who sent the action to PayPal
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/**
 * A buyer's "Report a problem" on a paid order, before (or instead of) a PayPal dispute. The store answers it here:
 * a refund through PayPal, or a reply. assessment is computed when the report is made, from the stored mandate and
 * the cart guard result, so a clear agent mistake (the agent bought outside what was signed) is plain to see.
 */
export const problemReports = pgTable(
  'problem_reports',
  {
    reportId: text('report_id').primaryKey(), // "rpt_<hex>"
    paypalOrderId: text('paypal_order_id')
      .notNull()
      .references(() => orders.paypalOrderId),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(), // see ProblemKind
    message: text('message').notNull(),
    assessment: jsonb('assessment').$type<ReportAssessment>().notNull(),
    status: text('status').notNull().default('open'), // 'open' | 'refunded' | 'closed'
    reply: text('reply'),
    refundId: text('refund_id'),
    refundMinor: integer('refund_minor'),
    resolvedBy: text('resolved_by').references(() => users.id),
    resolvedAt: ts('resolved_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('problem_reports_order_idx').on(t.paypalOrderId)],
);

/** Raw webhook / poll events, stored once by event id so processing is idempotent. */
export const events = pgTable('events', {
  eventId: text('event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  source: text('source').notNull(), // 'webhook' | 'poll'
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  processed: boolean('processed').notNull().default(false),
  receivedAt: ts('received_at').notNull().defaultNow(),
});

/**
 * Store settings the owner can change in the app (one row, id "store"). Secrets are never stored here; they stay
 * in environment variables. Columns left null fall back to the environment defaults (see lib/settings.ts).
 */
export const settings = pgTable('settings', {
  id: text('id').primaryKey().default('store'),
  storeName: text('store_name'),
  supportEmail: text('support_email'),
  approvalThresholdMinor: integer('approval_threshold_minor'),
  humanReviewOverMinor: integer('human_review_over_minor'),
  minConfidence: real('min_confidence'),
  autoAnalyse: boolean('auto_analyse'), // null = default (on)
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/**
 * Who changed what, and when. Written for settings, roles, account status, mandate revocations and dispute actions.
 * Append-only: nothing updates or deletes rows. actor_email is copied so the entry still reads right if the user changes.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    at: ts('at').notNull().defaultNow(),
    actorId: text('actor_id'), // null for the system (webhooks, scripts)
    actorEmail: text('actor_email'),
    action: text('action').notNull(), // e.g. settings.update, user.role, user.disable, mandate.revoke, case.act
    targetType: text('target_type'),
    targetId: text('target_id'),
    details: jsonb('details').$type<Record<string, unknown>>(),
  },
  (t) => [index('audit_log_at_idx').on(t.at)],
);
