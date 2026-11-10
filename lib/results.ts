/**
 * The results page (owner: orchestrator): what MandatePay did, computed from stored records only. Pure
 * computeResults() is unit-tested; loadResults() reads the database. The one estimate (minutes saved) says what
 * it assumes.
 */
import type { ResultsResponse } from '../contracts/schemas';

/** Assumed minutes a person spends on one dispute by hand: read it, find the order and proof, write the response. */
export const MANUAL_MINUTES_PER_DISPUTE = 20;

export interface ResultsInput {
  cases: { disputeId: string; analysed: boolean; outcome: string | null; status: string | null; createdAt: Date }[];
  acts: { disputeId: string; at: Date; action: string | null; override: boolean; humanApproved: boolean }[];
  carts: { verdict: 'allow' | 'block' | 'escalate'; totalMinor: number; currency: string }[];
  ordersPaid: number;
  refunds: { amountMinor: number; currency: string; status: string }[];
  reports: { status: string; agentMistake: boolean }[];
  evalResults: ResultsResponse['eval'];
  now?: Date;
}

const money = (minor: number, currency: string) => ({ value: (minor / 100).toFixed(2), currency });

/** Sum per currency and report the currency with the most money (the store sells in one currency in practice). */
function topCurrency(rows: { amountMinor: number; currency: string }[]) {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + r.amountMinor);
  const best = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? money(best[1], best[0]) : null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function computeResults(i: ResultsInput): ResultsResponse {
  // Responses: what was sent to PayPal. NO_ACTION is a note to self, not a response.
  const sent = i.acts.filter((a) => a.action && a.action !== 'NO_ACTION');
  const firstSent = new Map<string, Date>();
  for (const a of sent) {
    const prev = firstSent.get(a.disputeId);
    if (!prev || a.at < prev) firstSent.set(a.disputeId, a.at);
  }
  const minutes: number[] = [];
  for (const c of i.cases) {
    const at = firstSent.get(c.disputeId);
    if (at) minutes.push(Math.max(0, (at.getTime() - c.createdAt.getTime()) / 60000));
  }
  const med = median(minutes);
  const analysed = i.cases.filter((c) => c.analysed).length;
  const counted = i.refunds.filter((r) => r.status === 'COMPLETED' || r.status === 'PENDING');
  const blocked = i.carts.filter((c) => c.verdict === 'block');

  return {
    generated_at: (i.now ?? new Date()).toISOString(),
    disputes: {
      total: i.cases.length,
      analysed,
      responded: firstSent.size,
      resolved: i.cases.filter((c) => c.status === 'RESOLVED').length,
      store_won: i.cases.filter((c) => c.outcome?.startsWith('RESOLVED_SELLER_FAVOUR')).length,
      buyer_won: i.cases.filter((c) => c.outcome?.startsWith('RESOLVED_BUYER_FAVOUR')).length,
    },
    people: {
      responses: sent.length,
      followed_ai: sent.filter((a) => !a.override).length,
      changed_ai: sent.filter((a) => a.override).length,
      approved_by_person: sent.filter((a) => a.humanApproved).length,
    },
    speed: {
      median_minutes_to_response: med === null ? null : Math.round(med),
      est_minutes_saved: analysed * MANUAL_MINUTES_PER_DISPUTE,
      manual_minutes_per_dispute: MANUAL_MINUTES_PER_DISPUTE,
    },
    guard: {
      carts_checked: i.carts.length,
      allowed: i.carts.filter((c) => c.verdict === 'allow').length,
      needed_approval: i.carts.filter((c) => c.verdict === 'escalate').length,
      blocked: blocked.length,
      blocked_value: topCurrency(blocked.map((c) => ({ amountMinor: c.totalMinor, currency: c.currency }))),
      orders_paid: i.ordersPaid,
    },
    reports: {
      total: i.reports.length,
      open: i.reports.filter((r) => r.status === 'open').length,
      refunded: i.reports.filter((r) => r.status === 'refunded').length,
      closed: i.reports.filter((r) => r.status === 'closed').length,
      agent_mistakes: i.reports.filter((r) => r.agentMistake).length,
    },
    refunds: { count: counted.length, total: topCurrency(counted) },
    eval: i.evalResults,
  };
}

export async function loadResults(): Promise<ResultsResponse> {
  const [{ db, schema }, { eq, isNotNull }, evalJson] = await Promise.all([
    import('../db/client'),
    import('drizzle-orm'),
    import('../eval/results.json').then((m) => m.default as ResultsResponse['eval']).catch(() => null),
  ]);
  const [cases, acts, carts, orders, reports] = await Promise.all([
    db
      .select({ disputeId: schema.cases.disputeId, verdict: schema.cases.verdict, outcome: schema.cases.outcome, status: schema.cases.status, createdAt: schema.cases.createdAt })
      .from(schema.cases),
    db
      .select({ targetId: schema.auditLog.targetId, at: schema.auditLog.at, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'case.act')),
    db.select({ guard: schema.carts.guard, totalMinor: schema.carts.totalMinor, currency: schema.carts.currency }).from(schema.carts),
    db.select({ refunds: schema.orders.refunds }).from(schema.orders).where(isNotNull(schema.orders.captureId)),
    db.select({ status: schema.problemReports.status, assessment: schema.problemReports.assessment }).from(schema.problemReports),
  ]);
  return computeResults({
    cases: cases.map((c) => ({ disputeId: c.disputeId, analysed: !!c.verdict, outcome: c.outcome, status: c.status, createdAt: c.createdAt })),
    acts: acts
      .filter((a) => a.targetId)
      .map((a) => ({
        disputeId: a.targetId as string,
        at: a.at,
        action: typeof a.details?.action === 'string' ? a.details.action : null,
        override: a.details?.override != null,
        humanApproved: a.details?.human_approved === true,
      })),
    carts: carts.map((c) => ({ verdict: c.guard.verdict, totalMinor: c.totalMinor, currency: c.currency })),
    ordersPaid: orders.length,
    refunds: orders.flatMap((o) => (o.refunds ?? []).map((r) => ({ amountMinor: r.amount_minor, currency: r.currency, status: r.status }))),
    reports: reports.map((r) => ({ status: r.status, agentMistake: r.assessment.agent_mistake })),
    evalResults: evalJson,
  });
}
