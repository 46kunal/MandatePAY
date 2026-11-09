/**
 * Dispute ingestion (owner: A). Shared by the poller (main path) and the webhook receiver.
 * Pure orchestration over injected dependencies, so it is unit-tested without Postgres or PayPal.
 *
 * Each dispute is stored once per (dispute_id, update_time) in `events`, so polling twice, or a webhook that
 * races the poller, never processes the same change twice. Cases are linked to our orders by capture id.
 */
import { toMinor } from './orders';
import type { RawDispute } from './disputes';

export type EventSource = 'webhook' | 'poll';

export interface CaseUpsert {
  disputeId: string;
  captureId: string | null;
  paypalOrderId: string | null;
  mandateId: string | null;
  reason: string | null;
  stage: string | null;
  status: string | null;
  amountMinor: number | null;
  currency: string | null;
  /** Final result once PayPal resolved the dispute; null while it is open (an existing outcome is then kept). */
  outcome: string | null;
  rawDispute: Record<string, unknown>;
}

export interface LinkedOrder {
  paypalOrderId: string;
  mandateId: string;
  captureId: string;
}

export interface DisputeStore {
  hasEvent(eventId: string): Promise<boolean>;
  insertEvent(e: { eventId: string; eventType: string; source: EventSource; payload: Record<string, unknown> }): Promise<void>;
  markEventProcessed(eventId: string): Promise<void>;
  caseExists(disputeId: string): Promise<boolean>;
  /** Insert or update the case row. Must keep any verdict, analysis status and action already stored. */
  upsertCase(row: CaseUpsert): Promise<void>;
  findOrderByCapture(captureId: string): Promise<LinkedOrder | undefined>;
}

export interface IngestResult {
  /** False when this exact change was already processed. */
  processed: boolean;
  isNew: boolean;
  linked: boolean;
}

export function disputeEventId(raw: Pick<RawDispute, 'dispute_id' | 'update_time' | 'status' | 'dispute_life_cycle_stage'>): string {
  return `dispute:${raw.dispute_id}:${raw.update_time ?? `${raw.dispute_life_cycle_stage ?? ''}-${raw.status ?? ''}`}`;
}

/** PayPal's final outcome code, only for a resolved dispute. */
export function disputeOutcome(raw: Pick<RawDispute, 'status' | 'dispute_outcome'>): string | null {
  const code = raw.dispute_outcome?.outcome_code;
  if (!code) return raw.status === 'RESOLVED' ? 'RESOLVED' : null;
  const refunded = raw.dispute_outcome?.amount_refunded;
  return refunded ? `${code} (refunded ${refunded.value} ${refunded.currency_code})` : code;
}

/** Store one dispute change and upsert its case. Idempotent on the event id. */
export async function ingestDispute(
  store: DisputeStore,
  raw: RawDispute,
  source: EventSource,
  opts: { eventId?: string; eventType?: string } = {},
): Promise<IngestResult> {
  const eventId = opts.eventId ?? disputeEventId(raw);
  if (await store.hasEvent(eventId)) return { processed: false, isNew: false, linked: false };

  // Store the raw event first, so nothing PayPal sent us is ever lost.
  await store.insertEvent({
    eventId,
    eventType: opts.eventType ?? 'DISPUTE_SNAPSHOT',
    source,
    payload: raw as unknown as Record<string, unknown>,
  });

  const isNew = !(await store.caseExists(raw.dispute_id));
  const captureId = raw.disputed_transactions?.[0]?.seller_transaction_id ?? null;
  const order = captureId ? await store.findOrderByCapture(captureId) : undefined;

  await store.upsertCase({
    disputeId: raw.dispute_id,
    captureId,
    paypalOrderId: order?.paypalOrderId ?? null,
    mandateId: order?.mandateId ?? null,
    reason: raw.reason ?? null,
    stage: raw.dispute_life_cycle_stage ?? null,
    status: raw.status ?? null,
    amountMinor: raw.dispute_amount ? toMinor(raw.dispute_amount.value) : null,
    currency: raw.dispute_amount?.currency_code ?? null,
    outcome: disputeOutcome(raw),
    rawDispute: raw as unknown as Record<string, unknown>,
  });
  await store.markEventProcessed(eventId);
  return { processed: true, isNew, linked: Boolean(order) };
}

export interface PollDeps {
  store: DisputeStore;
  listDisputes: () => Promise<Pick<RawDispute, 'dispute_id' | 'status' | 'update_time'>[]>;
  showDispute: (disputeId: string) => Promise<RawDispute>;
}

export interface PollResult {
  fetched: number;
  newCases: number;
  linked: number;
}

/**
 * List disputes, fetch the ones that changed since we last saw them, upsert cases.
 * `linked` counts cases matched to one of our orders among the disputes processed in this run.
 */
export async function pollDisputes(deps: PollDeps): Promise<PollResult> {
  const stubs = await deps.listDisputes();
  const result: PollResult = { fetched: stubs.length, newCases: 0, linked: 0 };

  for (const stub of stubs) {
    // Cheap skip: the list response already carries update_time, so unchanged disputes cost no detail call.
    if (stub.update_time && (await deps.store.hasEvent(disputeEventId(stub)))) continue;

    const raw = await deps.showDispute(stub.dispute_id);
    const r = await ingestDispute(deps.store, raw, 'poll');
    if (!r.processed) continue;
    if (r.isNew) result.newCases++;
    if (r.linked) result.linked++;
  }
  return result;
}
