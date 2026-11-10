/** Real dependencies for the order service: Postgres via Drizzle, PayPal via the shared client, B's mandate code. */
import type { Cart } from '../../contracts/schemas';
import { checkCart, computeReceiptHash, createClosedMandate, getOrCreateBuyerKey, hashCart, isBuyerKid, openMandateSigner, verifyClosedMandate } from '../mandate';
import { getPayPalClient } from './client';
import type { DisputeStore, PollDeps } from './disputeService';
import type { ActDeps, ActStore } from './caseActions';
import {
  acceptClaim,
  listDisputes,
  makeOffer,
  provideEvidence,
  sendMessage,
  showDispute,
  type EvidenceFile,
  type RawDispute,
} from './disputes';
import { captureOrder, createOrder } from './orders';
import type { CartRow, LedgerStore, OrderDeps, OrderRow } from './service';

/** Drizzle-backed ledger. The DB client is imported lazily so unit tests never need DATABASE_URL. */
export function drizzleStore(): LedgerStore {
  const load = async () => {
    const [{ and, desc, eq, gte, isNull }, { db, schema }] = await Promise.all([
      import('drizzle-orm'),
      import('../../db/client'),
    ]);
    return { and, desc, eq, gte, isNull, db, schema };
  };

  return {
    async findOpenOrder(q) {
      const { and, desc, eq, gte, isNull, db, schema } = await load();
      const { orders, carts } = schema;
      const [row] = await db
        .select({ paypalOrderId: orders.paypalOrderId, approveUrl: orders.approveUrl, cartId: orders.cartId })
        .from(orders)
        .innerJoin(carts, eq(carts.cartId, orders.cartId))
        .where(
          and(
            eq(orders.mandateId, q.mandateId),
            eq(carts.cartHash, q.cartHash),
            eq(carts.approvedBy, q.approvedBy),
            isNull(orders.captureId),
            gte(orders.createdAt, q.since),
          ),
        )
        .orderBy(desc(orders.createdAt))
        .limit(1);
      return row;
    },
    async getMandate(mandateId) {
      const { eq, db, schema } = await load();
      const [row] = await db.select().from(schema.mandates).where(eq(schema.mandates.mandateId, mandateId)).limit(1);
      return row ? { mandateId: row.mandateId, jws: row.jws, revokedAt: row.revokedAt } : undefined;
    },
    async getCart(cartId) {
      const { eq, db, schema } = await load();
      const [row] = await db.select().from(schema.carts).where(eq(schema.carts.cartId, cartId)).limit(1);
      if (!row) return undefined;
      return {
        cartId: row.cartId,
        mandateId: row.mandateId,
        cart: row.cart as Cart,
        cartHash: row.cartHash,
        totalMinor: row.totalMinor,
        currency: row.currency,
        guard: row.guard,
        closedMandateJws: row.closedMandateJws,
        approvedBy: (row.approvedBy as CartRow['approvedBy']) ?? null,
      };
    },
    async getOrder(paypalOrderId) {
      const { eq, db, schema } = await load();
      const [row] = await db.select().from(schema.orders).where(eq(schema.orders.paypalOrderId, paypalOrderId)).limit(1);
      return row as OrderRow | undefined;
    },
    async insertCart(row) {
      const { db, schema } = await load();
      await db.insert(schema.carts).values(row);
    },
    async insertOrder(row) {
      const { db, schema } = await load();
      await db.insert(schema.orders).values(row);
    },
    async markCaptured(paypalOrderId, fields) {
      const { and, eq, isNull, db, schema } = await load();
      const updated = await db
        .update(schema.orders)
        .set({ ...fields, capturedAt: new Date() })
        .where(and(eq(schema.orders.paypalOrderId, paypalOrderId), isNull(schema.orders.captureId)))
        .returning({ id: schema.orders.paypalOrderId });
      return updated.length > 0;
    },
  };
}

/** Drizzle-backed store for dispute ingestion (events + cases). */
export function drizzleDisputeStore(): DisputeStore {
  const load = async () => {
    const [{ eq }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
    return { eq, db, schema };
  };

  return {
    async hasEvent(eventId) {
      const { eq, db, schema } = await load();
      const [row] = await db.select({ id: schema.events.eventId }).from(schema.events).where(eq(schema.events.eventId, eventId)).limit(1);
      return Boolean(row);
    },
    async insertEvent(e) {
      const { db, schema } = await load();
      await db.insert(schema.events).values(e).onConflictDoNothing();
    },
    async markEventProcessed(eventId) {
      const { eq, db, schema } = await load();
      await db.update(schema.events).set({ processed: true }).where(eq(schema.events.eventId, eventId));
    },
    async caseExists(disputeId) {
      const { eq, db, schema } = await load();
      const [row] = await db.select({ id: schema.cases.disputeId }).from(schema.cases).where(eq(schema.cases.disputeId, disputeId)).limit(1);
      return Boolean(row);
    },
    async upsertCase(row) {
      const { db, schema } = await load();
      // On conflict only the PayPal-derived fields change; verdict, analysis_status and action stay as they were.
      const { disputeId: _id, outcome, ...updatable } = row;
      await db
        .insert(schema.cases)
        .values(row)
        .onConflictDoUpdate({
          target: schema.cases.disputeId,
          // A null outcome (dispute still open) must not erase the outcome recorded when we acted.
          set: { ...updatable, ...(outcome !== null ? { outcome } : {}), updatedAt: new Date() },
        });
    },
    async findOrderByCapture(captureId) {
      const { eq, db, schema } = await load();
      const [o] = await db.select().from(schema.orders).where(eq(schema.orders.captureId, captureId)).limit(1);
      return o ? { paypalOrderId: o.paypalOrderId, mandateId: o.mandateId, captureId } : undefined;
    },
  };
}

/** Drizzle-backed store for acting on cases. */
export function drizzleActStore(): ActStore {
  const load = async () => {
    const [{ and, eq, ne, or }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
    return { and, eq, ne, or, db, schema };
  };

  return {
    async getCase(disputeId) {
      const { eq, db, schema } = await load();
      const [row] = await db.select().from(schema.cases).where(eq(schema.cases.disputeId, disputeId)).limit(1);
      return row ? { row, rawDispute: (row.rawDispute as RawDispute | null) ?? null } : undefined;
    },
    async markActed(disputeId, f) {
      const { and, eq, ne, or, db, schema } = await load();
      const now = new Date();
      const [row] = await db
        .update(schema.cases)
        .set({
          analysisStatus: f.close === false ? 'analysed' : 'acted',
          actionTaken: f.action,
          outcome: f.outcome,
          humanApprovedAt: f.humanApproved ? now : null,
          actedBy: f.actedBy ?? null,
          updatedAt: now,
        })
        // Conditional update: the second of two concurrent requests matches nothing and gets a 409.
        .where(
          and(
            eq(schema.cases.disputeId, disputeId),
            or(ne(schema.cases.analysisStatus, 'acted'), eq(schema.cases.actionTaken, 'NO_ACTION')),
          ),
        )
        .returning();
      return row;
    },
  };
}

export function defaultActDeps(): ActDeps {
  const client = getPayPalClient();
  return {
    store: drizzleActStore(),
    actions: {
      provideEvidence: (id, notes, files) => provideEvidence(client, id, notes, files),
      makeOffer: (id, offer) => makeOffer(client, id, offer),
      acceptClaim: (id, note) => acceptClaim(client, id, note),
      sendMessage: (id, message, files) => sendMessage(client, id, message, files),
    },
    evidenceFiles: evidencePackFiles,
    evidenceMessage: async (id) => {
      const { getCaseDetail } = await import('./cases');
      const { evidenceMessageText } = await import('./evidencePack');
      const detail = await getCaseDetail(id);
      return detail ? { text: evidenceMessageText(detail), files: await evidencePackFiles(id) } : null;
    },
  };
}

/** The evidence pack PDF (same document as GET /api/cases/[id]/evidence-pack), attached to PROVIDE_EVIDENCE. */
async function evidencePackFiles(disputeId: string): Promise<EvidenceFile[]> {
  const [{ getCaseDetail }, { buildEvidenceModel, renderEvidencePdf }] = await Promise.all([
    import('./cases'),
    import('./evidencePack'),
  ]);
  const detail = await getCaseDetail(disputeId);
  if (!detail) return [];
  const pdf = await renderEvidencePdf(buildEvidenceModel(detail));
  const safe = disputeId.replace(/[^A-Za-z0-9_-]/g, '_');
  return [{ filename: `evidence-${safe}.pdf`, contentType: 'application/pdf', bytes: new Uint8Array(pdf) }];
}

export function defaultPollDeps(): PollDeps {
  const client = getPayPalClient();
  return {
    store: drizzleDisputeStore(),
    listDisputes: () => listDisputes(client),
    showDispute: (id) => showDispute(client, id),
  };
}

export function defaultDeps(): OrderDeps {
  const client = getPayPalClient();
  return {
    store: drizzleStore(),
    checkCart: (jws, cart) => checkCart(jws, cart),
    hashCart,
    // When the buyer approves a cart, their own key signs it, if their open mandate was signed with their own key.
    createClosedMandate: async (input) => {
      const open = openMandateSigner(input.openMandateJws);
      if (input.approvedBy === 'buyer' && isBuyerKid(open.kid) && open.buyerRef) {
        return createClosedMandate(input, { buyerKey: await getOrCreateBuyerKey(open.buyerRef) });
      }
      return createClosedMandate(input);
    },
    verifyClosedMandate,
    computeReceiptHash,
    createOrder: (input) => createOrder(client, input),
    captureOrder: (id) => captureOrder(client, id),
  };
}
