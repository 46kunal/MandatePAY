// OWNER: C. Plain-English labels and formatting shared by the buyer and merchant views.
import type { AnalysisStatus, CaseRecord, Verdict } from '@/contracts/schemas';

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
  agent: { label: 'Agent error', tone: 'warn' },
  buyer_regret: { label: 'Buyer regret', tone: 'info' },
  unclear: { label: 'Unclear', tone: 'neutral' },
};

export const STATUS: Record<AnalysisStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Not analysed yet', tone: 'neutral' },
  analysed: { label: 'Analysed', tone: 'info' },
  awaiting_human: { label: 'Needs your review', tone: 'warn' },
  acted: { label: 'Action taken', tone: 'good' },
  error: { label: 'Analysis failed', tone: 'bad' },
};

export const ACTION: Record<string, string> = {
  PROVIDE_EVIDENCE: 'Send evidence',
  MAKE_OFFER: 'Make an offer',
  ACCEPT_CLAIM: 'Accept the claim',
  SEND_MESSAGE: 'Send a message',
  NO_ACTION: 'Do nothing',
};

export const RULE: Record<string, string> = {
  max_total: 'Spending limit',
  categories: 'Product category',
  max_quantity: 'Quantity',
  required_attributes: 'Required details',
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

/** Guard check status -> badge, for the buyer's rule list. (The merchant diff uses Match / Mismatch instead.) */
export const CHECK_RESULT: Record<'pass' | 'fail' | 'unsure' | 'escalate', { label: string; tone: Tone }> = {
  pass: { label: 'Pass', tone: 'good' },
  fail: { label: 'Fail', tone: 'bad' },
  unsure: { label: 'Not confirmed', tone: 'warn' },
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
