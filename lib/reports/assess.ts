/**
 * What the store should make of a buyer's problem report (owner: orchestrator). Pure, unit-tested.
 * Built only from the stored records (the cart guard result at checkout), never from the buyer's text: the buyer's
 * words go to a person, not into this decision.
 */
import type { GuardResult, ProblemKind, ProblemReport, ReportAssessment } from '../../contracts/schemas';
import { ruleText } from './ruleText';

export function assessReport(kind: ProblemKind, guard: GuardResult | null): ReportAssessment {
  const notPassing = (guard?.checks ?? []).filter((c) => c.status !== 'pass');
  const doubts = notPassing.map((c) => `${ruleText(c.rule)}: ${c.detail}`).join('; ');

  if (!guard) {
    return { agent_mistake: false, suggestion: 'review', summary: 'No checkout check was recorded for this order. Review it by hand.', checks: [] };
  }

  if (kind === 'agent_mistake') {
    if (notPassing.length > 0) {
      return {
        agent_mistake: true,
        suggestion: 'refund',
        summary: `At checkout the guard could not confirm everything against the signed mandate (${doubts}). The agent bought outside what the buyer clearly asked for, so a refund is fair.`,
        checks: notPassing,
      };
    }
    return {
      agent_mistake: false,
      suggestion: 'review',
      summary: 'Every check passed at checkout: the items, prices and limits matched what the buyer signed. Reply to the buyer before deciding on a refund.',
      checks: [],
    };
  }

  const lead: Record<Exclude<ProblemKind, 'agent_mistake'>, string> = {
    not_received: 'The buyer says the order has not arrived. Check the delivery, then refund or reply.',
    damaged: 'The buyer says the item arrived damaged or not as described. Ask for details or refund.',
    other: 'Read the buyer\'s message, then refund or reply.',
  };
  return {
    agent_mistake: notPassing.length > 0,
    suggestion: notPassing.length > 0 ? 'refund' : 'review',
    summary: notPassing.length > 0 ? `${lead[kind]} Also, the guard had doubts at checkout (${doubts}).` : lead[kind],
    checks: notPassing,
  };
}

export const KIND_LABEL: Record<ProblemKind, string> = {
  agent_mistake: 'The agent bought the wrong thing',
  not_received: 'It has not arrived',
  damaged: 'Damaged or not as described',
  other: 'Something else',
};

export interface ReportRow {
  reportId: string;
  paypalOrderId: string;
  kind: string;
  message: string;
  assessment: ReportAssessment;
  status: string;
  reply: string | null;
  refundMinor: number | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export function toProblemReport(r: ReportRow, currency: string): ProblemReport {
  return {
    report_id: r.reportId,
    paypal_order_id: r.paypalOrderId,
    kind: r.kind as ProblemKind,
    message: r.message,
    assessment: r.assessment,
    status: r.status as ProblemReport['status'],
    reply: r.reply,
    refund: r.refundMinor != null ? { value: (r.refundMinor / 100).toFixed(2), currency } : null,
    created_at: r.createdAt.toISOString(),
    resolved_at: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  };
}
