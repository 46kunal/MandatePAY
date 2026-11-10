// OWNER: C. Plain-English labels and formatting shared by the buyer and merchant views.
import type { ActionType, AnalysisStatus, CaseRecord, Verdict } from '@/contracts/schemas';

export type Tone = 'good' | 'bad' | 'warn' | 'info' | 'neutral';

const REASONS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item not received',
  ITEM_NOT_RECEIVED: 'Item not received',
  UNAUTHORISED: 'Unauthorised purchase',
  UNAUTHORIZED: 'Unauthorised purchase',
  CREDIT_NOT_PROCESSED: 'Refund not received',
  DUPLICATE_TRANSACTION: 'Duplicate charge',
  INCORRECT_AMOUNT: 'Wrong amount',
};

/** "SOME_REASON_CODE" -> "Some reason code" when we have no hand-written label. */
export function reasonLabel(code: string | null | undefined): string {
  if (!code) return 'Unknown reason';
  if (REASONS[code]) return REASONS[code];
  const s = code.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const FAULT: Record<Verdict['fault'], { label: string; tone: Tone }> = {
  merchant: { label: 'Merchant at fault', tone: 'bad' },
  agent: { label: 'Agent at fault', tone: 'warn' },
  buyer_regret: { label: 'Buyer regret', tone: 'info' },
  unclear: { label: 'Needs further review', tone: 'neutral' },
};

/** What each classification means for the merchant, in one plain sentence each. */
export const OUTCOME: Record<Verdict['fault'], { headline: string; meaning: string; followUp?: string }> = {
  merchant: {
    headline: 'The merchant is likely at fault',
    meaning: 'The buyer authorised the right purchase, but what arrived does not match it. A refund is the fair outcome.',
  },
  agent: {
    headline: 'The shopping agent is likely at fault',
    meaning: 'The merchant fulfilled the order as listed, but the agent bought something the buyer did not clearly authorise.',
    followUp: 'Suggested follow-up (not automated): review the agent that placed this order.',
  },
  buyer_regret: {
    headline: 'This looks like buyer regret',
    meaning: 'The cart respected the buyer’s mandate and the order appears to have been fulfilled. Respond with the evidence.',
  },
  unclear: {
    headline: 'The evidence does not settle this',
    meaning: 'The AI could not decide fairly on the data available. A person should review the case before anything is sent.',
  },
};

export const STATUS: Record<AnalysisStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Not analysed', tone: 'neutral' },
  analysed: { label: 'Ready to review', tone: 'info' },
  awaiting_human: { label: 'Needs your review', tone: 'warn' },
  acted: { label: 'Resolved', tone: 'good' },
  error: { label: 'Analysis failed', tone: 'bad' },
};

export const ACTION: Record<string, string> = {
  PROVIDE_EVIDENCE: 'Send evidence',
  MAKE_OFFER: 'Make an offer',
  ACCEPT_CLAIM: 'Accept the claim',
  SEND_MESSAGE: 'Send a message',
  NO_ACTION: 'Do nothing',
};

export const ACTION_LIST: ActionType[] = ['PROVIDE_EVIDENCE', 'MAKE_OFFER', 'ACCEPT_CLAIM', 'SEND_MESSAGE', 'NO_ACTION'];

export const OFFER_LABEL: Record<string, string> = {
  REFUND: 'Full refund',
  REFUND_WITH_RETURN: 'Refund after the item is returned',
  REFUND_WITH_REPLACEMENT: 'Refund with a replacement',
  REPLACEMENT_WITHOUT_REFUND: 'Replacement only',
};

export const RULE: Record<string, string> = {
  max_total: 'Budget',
  categories: 'Product category',
  max_quantity: 'Quantity',
  required_attributes: 'Size and attributes',
  deadline: 'Delivery deadline',
  approval_threshold: 'Approval limit',
  require_approval_over: 'Approval limit',
};

export function ruleLabel(rule: string): string {
  return RULE[rule] ?? rule.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function formatMoney(value: string, currency: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${value} ${currency}`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return `${value} ${currency}`;
  }
}

export function formatWhen(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.round((now - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} d ago`;
  return new Date(t).toLocaleDateString();
}

/** A case needs the merchant's attention when the analyst asked for a human and nothing was done yet. */
export function needsReview(c: CaseRecord): boolean {
  return c.analysis_status === 'awaiting_human';
}

/** Guard check status -> label and tone. */
export const CHECK_RESULT: Record<'pass' | 'fail' | 'unsure' | 'escalate', { label: string; tone: Tone }> = {
  pass: { label: 'Passed', tone: 'good' },
  fail: { label: 'Failed', tone: 'bad' },
  unsure: { label: 'Could not confirm', tone: 'warn' },
  escalate: { label: 'Needs approval', tone: 'warn' },
};

/** "color" -> "Color". Attribute names come from the buyer's words, so tidy them for display. */
export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Date only, in UTC so "Nov 20" never shows as Nov 21 in a timezone ahead of UTC. */
export function formatDay(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

/** "Respond by 29 Nov (in 19 days)" / "Waiting for the buyer until 29 Nov" / overdue, from CaseRecord.response_due. */
export function dueLabel(
  due: { party: 'seller' | 'buyer'; at: string } | null | undefined,
  now = Date.now(),
): { text: string; tone: 'bad' | 'warn' | 'neutral' } | null {
  if (!due) return null;
  const ms = Date.parse(due.at) - now;
  if (Number.isNaN(ms)) return null;
  const days = Math.ceil(ms / 86_400_000);
  const day = formatDay(due.at);
  if (due.party === 'buyer') return { text: `Waiting for the buyer until ${day}`, tone: 'neutral' };
  if (ms <= 0) return { text: `Response was due ${day}`, tone: 'bad' };
  const left = days <= 1 ? 'today or tomorrow' : `in ${days} days`;
  return { text: `Respond by ${day} (${left})`, tone: days <= 3 ? 'bad' : days <= 7 ? 'warn' : 'neutral' };
}
