/**
 * Webhook receiver logic (owner: A). Pure orchestration over injected dependencies, unit-tested without PayPal or Postgres.
 *
 * Order: verify the PayPal signature (400 if bad), ignore events that are not dispute events, then re-fetch the
 * dispute from PayPal instead of trusting the payload, and ingest it. The webhook event id is the idempotency key,
 * so PayPal retries and the poller racing the webhook never process the same change twice.
 */
import { ingestDispute, type DisputeStore } from './disputeService';
import type { RawDispute } from './disputes';

export interface WebhookDeps {
  store: DisputeStore;
  verify(headers: Headers, event: unknown): Promise<boolean>;
  showDispute(disputeId: string): Promise<RawDispute>;
}

export type WebhookResult =
  | { ok: true; handled: 'processed' | 'duplicate' | 'ignored'; disputeId?: string }
  | { ok: false; httpStatus: 400; error: string; message: string };

interface WebhookEvent {
  id?: string;
  event_type?: string;
  resource?: { dispute_id?: string };
}

export async function handleWebhook(deps: WebhookDeps, headers: Headers, rawBody: string): Promise<WebhookResult> {
  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return { ok: false, httpStatus: 400, error: 'invalid_json', message: 'Body is not valid JSON.' };
  }
  if (!(await deps.verify(headers, event))) {
    return { ok: false, httpStatus: 400, error: 'bad_signature', message: 'Webhook signature could not be verified.' };
  }

  const type = event.event_type ?? '';
  const disputeId = event.resource?.dispute_id;
  if (!event.id || !type.startsWith('CUSTOMER.DISPUTE.') || !disputeId) return { ok: true, handled: 'ignored' };

  const eventId = `webhook:${event.id}`;
  if (await deps.store.hasEvent(eventId)) return { ok: true, handled: 'duplicate', disputeId };

  const raw = await deps.showDispute(disputeId);
  const r = await ingestDispute(deps.store, raw, 'webhook', { eventId, eventType: type });
  return { ok: true, handled: r.processed ? 'processed' : 'duplicate', disputeId };
}
