/**
 * Database schema (Postgres via Drizzle). OWNER: C implements and migrates; orchestrator approves changes.
 * Column shapes mirror contracts/schemas.ts. Totals are integer minor units.
 */
import { bigint, boolean, index, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import type { Cart, Constraints, GuardResult, Verdict } from '../contracts/schemas';

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
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
