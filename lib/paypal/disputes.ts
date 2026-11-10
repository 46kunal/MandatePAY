/**
 * PayPal Disputes API (owner: A).
 *
 * Verified against a real sandbox dispute (see README): seller_transaction_id equals our orders.capture_id.
 * Links / allowed_response_options confirmed for UNDER_PAYPAL_REVIEW (only `self`) and WAITING_FOR_SELLER_RESPONSE (underscore rels).
 */
import { OfferType, type ActionType, type DisputeSummary, type Money } from '../../contracts/schemas';
import type { PayPalClient } from './client';
import { PayPalError } from './errors';

interface PayPalLink {
  rel: string;
  href: string;
  method?: string;
}

export interface RawDispute {
  dispute_id: string;
  reason?: string;
  status?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: { currency_code: string; value: string };
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string }[];
  messages?: { posted_by?: string; content?: string; time_posted?: string }[];
  allowed_response_options?: Record<string, unknown>;
  /** Present once the dispute is resolved, e.g. outcome_code RESOLVED_BUYER_FAVOUR / RESOLVED_SELLER_FAVOUR. */
  dispute_outcome?: { outcome_code?: string; amount_refunded?: { currency_code: string; value: string } };
  links?: PayPalLink[];
  update_time?: string;
  create_time?: string;
  /** When the seller must respond by (while PayPal waits on the seller). */
  seller_response_due_date?: string;
  /** When the buyer must respond by (while PayPal waits on the buyer). */
  buyer_response_due_date?: string;
}

/** Who PayPal is waiting on, and until when. null when no response is due (under review, resolved). */
export function responseDue(d: Pick<RawDispute, 'seller_response_due_date' | 'buyer_response_due_date'> | null | undefined):
  | { party: 'seller' | 'buyer'; at: string }
  | null {
  if (d?.seller_response_due_date) return { party: 'seller', at: d.seller_response_due_date };
  if (d?.buyer_response_due_date) return { party: 'buyer', at: d.buyer_response_due_date };
  return null;
}

/** Link relation -> analyst action. HATEOAS links are what PayPal actually permits right now. */
const LINK_TO_ACTION: Record<string, ActionType> = {
  'provide-evidence': 'PROVIDE_EVIDENCE',
  'make-offer': 'MAKE_OFFER',
  'accept-claim': 'ACCEPT_CLAIM',
  'send-message': 'SEND_MESSAGE',
};

/** Same, keyed by allowed_response_options property names (fallback when links are absent). */
const OPTION_TO_ACTION: Record<string, ActionType> = {
  provide_evidence: 'PROVIDE_EVIDENCE',
  make_offer: 'MAKE_OFFER',
  offer: 'MAKE_OFFER',
  accept_claim: 'ACCEPT_CLAIM',
  send_message: 'SEND_MESSAGE',
};

export function deriveAllowedActions(d: Pick<RawDispute, 'links' | 'allowed_response_options'>): ActionType[] {
  const found = new Set<ActionType>();
  for (const l of d.links ?? []) {
    // Docs use hyphens (make-offer) but the sandbox returns underscores (make_offer): accept both.
    const a = LINK_TO_ACTION[l.rel.replace(/_/g, '-')];
    if (a) found.add(a);
  }
  for (const key of Object.keys(d.allowed_response_options ?? {})) {
    const a = OPTION_TO_ACTION[key];
    if (a) found.add(a);
  }
  found.add('NO_ACTION'); // doing nothing is always possible
  return [...found];
}

export function deriveOfferTypes(d: Pick<RawDispute, 'allowed_response_options'>): OfferType[] {
  const opts = d.allowed_response_options ?? {};
  const block = (opts.make_offer ?? opts.offer) as { offer_types?: unknown } | undefined;
  const raw = Array.isArray(block?.offer_types) ? block.offer_types : [];
  return raw.flatMap((t) => {
    const p = OfferType.safeParse(t);
    return p.success ? [p.data] : [];
  });
}

/** Map a PayPal dispute to what B's analyst consumes. */
export function toDisputeSummary(d: RawDispute): DisputeSummary {
  const amount: Money | undefined = d.dispute_amount
    ? { value: d.dispute_amount.value, currency: d.dispute_amount.currency_code }
    : undefined;
  return {
    dispute_id: d.dispute_id,
    reason: d.reason ?? 'UNKNOWN',
    stage: d.dispute_life_cycle_stage ?? 'UNKNOWN',
    status: d.status ?? 'UNKNOWN',
    amount,
    seller_transaction_id: d.disputed_transactions?.[0]?.seller_transaction_id,
    allowed_actions: deriveAllowedActions(d),
    offer_types: deriveOfferTypes(d),
    ...(responseDue(d) ? { response_due: responseDue(d)! } : {}),
    messages: (d.messages ?? []).map((m) => ({
      from: m.posted_by ?? 'UNKNOWN',
      text: m.content ?? '',
      at: m.time_posted,
    })),
  };
}

/** One page of dispute stubs. PayPal returns only ids and a few fields here; call showDispute for detail. */
export async function listDisputes(client: PayPalClient, opts: { pageSize?: number; startTime?: string } = {}) {
  const data = await client.request<{ items?: Pick<RawDispute, 'dispute_id' | 'status' | 'update_time'>[] }>(
    '/v1/customer/disputes',
    { query: { page_size: opts.pageSize ?? 50, start_time: opts.startTime } },
  );
  return data?.items ?? [];
}

export function showDispute(client: PayPalClient, disputeId: string) {
  return client.request<RawDispute>(`/v1/customer/disputes/${encodeURIComponent(disputeId)}`);
}

const path = (id: string, action: string) => `/v1/customer/disputes/${encodeURIComponent(id)}/${action}`;

/**
 * Message to the other party (the buyer, at the inquiry stage). With files, PayPal takes a multipart request: the
 * message as JSON in `input` and the file in `message_document` (PayPal's send-message reference). If PayPal refuses
 * the upload, the same message goes out as plain text, so a rejected attachment never blocks the response.
 * Returns whether the files were attached.
 */
export async function sendMessage(client: PayPalClient, disputeId: string, message: string, files: EvidenceFile[] = []): Promise<{ attached: boolean }> {
  const requestId = `msg-${disputeId}-${fingerprint(message + files.map((f) => f.filename).join(','))}`;
  const file = files[0]; // PayPal's message accepts one document
  if (file) {
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify({ message })], { type: 'application/json' }));
    form.append('message_document', new Blob([file.bytes], { type: file.contentType }), file.filename);
    try {
      await client.request(path(disputeId, 'send-message'), { method: 'POST', form, requestId });
      return { attached: true };
    } catch (err) {
      // Not "PayPal is down" (status 0 / 5xx): a refusal of the upload format. Fall through to plain text.
      if (!(err instanceof PayPalError) || err.status === 0 || err.status >= 500 || err.status === 401 || err.status === 403) throw err;
    }
  }
  await client.request(path(disputeId, 'send-message'), {
    method: 'POST',
    body: { message },
    requestId: `msg-${disputeId}-${fingerprint(message)}`,
  });
  return { attached: false };
}

/** A file sent with provide-evidence. PayPal accepts PDF, JPG, GIF and PNG up to 10 MB each. */
export interface EvidenceFile {
  filename: string;
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Notes plus optional files. With files PayPal wants multipart/form-data: an `input` part holding the JSON and
 * one part per file (`file1`, `file2`, ...), each listed by name in `documents`.
 */
export function provideEvidence(client: PayPalClient, disputeId: string, notes: string, files: EvidenceFile[] = []) {
  const evidence = {
    evidence_type: 'OTHER',
    notes,
    ...(files.length ? { documents: files.map((f) => ({ name: f.filename })) } : {}),
  };
  const input = { evidences: [evidence] };
  const requestId = `evidence-${disputeId}-${fingerprint(notes + files.map((f) => f.filename).join(','))}`;
  if (!files.length) {
    return client.request(path(disputeId, 'provide-evidence'), { method: 'POST', body: input, requestId });
  }
  const form = new FormData();
  form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
  files.forEach((f, i) => form.append(`file${i + 1}`, new Blob([f.bytes], { type: f.contentType }), f.filename));
  return client.request(path(disputeId, 'provide-evidence'), { method: 'POST', form, requestId });
}

export function makeOffer(
  client: PayPalClient,
  disputeId: string,
  offer: { note: string; offerType: OfferType; amount: Money },
) {
  return client.request(path(disputeId, 'make-offer'), {
    method: 'POST',
    body: {
      note: offer.note,
      offer_type: offer.offerType,
      offer_amount: { currency_code: offer.amount.currency, value: offer.amount.value },
    },
    requestId: `offer-${disputeId}-${offer.offerType}-${offer.amount.value}`,
  });
}

export function acceptClaim(client: PayPalClient, disputeId: string, note: string) {
  return client.request(path(disputeId, 'accept-claim'), {
    method: 'POST',
    body: { note },
    requestId: `accept-${disputeId}`,
  });
}

/** Short stable fingerprint for idempotency keys (not security sensitive). */
function fingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
