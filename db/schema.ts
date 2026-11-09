/**
 * Database schema (Postgres via Drizzle). OWNER: C implements and migrates; orchestrator approves changes.
 * Column shapes mirror contracts/schemas.ts. Totals are integer minor units.
 */
import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Cart, Constraints, GuardResult, Verdict } from '../contracts/schemas';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** One row per confirmed open (checkout) mandate. */
export const mandates = pgTable('mandates', {
  mandateId: text('mandate_id').primaryKey(), // "mnd_<hex>", also stored in PayPal custom_id
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
