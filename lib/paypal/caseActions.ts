/**
 * Act on a dispute case (owner: A). Executes the analyst's verdict, or the merchant's override, through the
 * PayPal Disputes API. Pure orchestration over injected dependencies, so it is unit-tested without Postgres or PayPal.
 *
 * Order of checks (each failure returns before anything is sent to PayPal):
 *   404 unknown case, 409 already acted, 422 nothing to act on, 422 action/offer not allowed by PayPal for this
 *   dispute, 403 human approval missing, 422 incomplete offer. Only then is PayPal called.
 */
import type { ActionType, Money, OfferType, Verdict } from '../../contracts/schemas';
import type { CaseRow } from './cases';
import { toDisputeSummary, type EvidenceFile, type RawDispute } from './disputes';
import { PayPalError } from './errors';
import { fromMinor, toMinor } from './orders';

export interface ActInput {
  humanApproved: boolean;
  /** The person saw that the buyer was already refunded and still wants to offer or accept (see 409 already_refunded). */
  confirmRefunded?: boolean;
  /** The signed-in user sending the action, recorded on the case. */
  actedBy?: string;
  override?: { action: ActionType; offer_type?: OfferType; offer_amount?: string };
}

export interface ActCase {
  row: CaseRow;
  /** Latest raw dispute stored by the poller / webhook. Source of allowed actions and offer types. */
  rawDispute: RawDispute | null;
  /** Money already refunded on the payment (also outside MandatePay), read fresh from PayPal; null when none. */
  refunded?: { value: string; currency: string; pending: boolean; covers_dispute: 'none' | 'partial' | 'full' } | null;
}

export interface ActStore {
  getCase(disputeId: string): Promise<ActCase | undefined>;
  /**
   * Atomically record what was done. `close` (default true) marks the case acted; a no-action review passes
   * close: false so the case stays open while PayPal is still waiting. Returns the updated row, or undefined when it was already acted
   * (a concurrent request won), so the caller can answer 409.
   */
  markActed(
    disputeId: string,
    fields: { action: ActionType; outcome: string; humanApproved: boolean; actedBy?: string; close?: boolean },
  ): Promise<CaseRow | undefined>;
}

export interface DisputeActions {
  provideEvidence(disputeId: string, notes: string, files?: EvidenceFile[]): Promise<unknown>;
  makeOffer(disputeId: string, offer: { note: string; offerType: OfferType; amount: Money }): Promise<unknown>;
  acceptClaim(disputeId: string, note: string): Promise<unknown>;
  sendMessage(disputeId: string, message: string, files?: EvidenceFile[]): Promise<unknown>;
}

export interface ActDeps {
  store: ActStore;
  actions: DisputeActions;
  /** Files attached to PROVIDE_EVIDENCE (the evidence pack PDF). Optional: without it only notes are sent. */
  evidenceFiles?(disputeId: string): Promise<EvidenceFile[]>;
  /**
   * The evidence as a message (text built from the records, plus the PDF), for SEND_MESSAGE when the AI judged the
   * buyer's claim to be regret and PayPal offers no provide-evidence at this stage.
   */
  evidenceMessage?(disputeId: string): Promise<{ text: string; files: EvidenceFile[] } | null>;
}

export type ActResult =
  | { ok: true; row: CaseRow; action: ActionType }
  | { ok: false; httpStatus: 403 | 404 | 409 | 422 | 502; error: string; message: string; details?: unknown };

const fail = (httpStatus: 403 | 404 | 409 | 422 | 502, error: string, message: string, details?: unknown): ActResult => ({
  ok: false,
  httpStatus,
  error,
  message,
  details,
});

/** PayPal accepts long notes, but keep them well under the limit. */
const MAX_NOTE = 2000;

/**
 * Note sent to PayPal with an offer, an acceptance or evidence: the AI's reasoning and its claims. Our internal
 * bookkeeping never goes out: no "(source: ...)" field paths and no "[Guardrails]" notes.
 */
export function buildNote(verdict: Verdict | null, fallback: string): string {
  if (!verdict) return fallback;
  const reasoning = verdict.reasoning.split('\n[Guardrails]')[0].trim();
  const points = verdict.evidence_points.map((p, i) => `${i + 1}. ${p.claim}`);
  const text = [reasoning, ...points].filter(Boolean).join('\n');
  return (text || fallback).slice(0, MAX_NOTE);
}

/** A message to the buyer when the records-based message is unavailable. Never the AI's own notes. */
const NEUTRAL_MESSAGE = 'Hello. We are reviewing this dispute and will follow up here shortly. Thank you for your patience.';

export async function actOnCase(deps: ActDeps, disputeId: string, input: ActInput): Promise<ActResult> {
  const found = await deps.store.getCase(disputeId);
  if (!found) return fail(404, 'case_not_found', `No case with id ${disputeId}.`);
  const { row, rawDispute } = found;

  // A "no action" review answered nobody, so it never closes a case (older rows were stored as acted).
  if (row.analysisStatus === 'acted' && row.actionTaken !== 'NO_ACTION') {
    return fail(409, 'already_acted', `Case ${disputeId} was already acted on (${row.actionTaken ?? 'unknown action'}).`);
  }

  const verdict = (row.verdict as Verdict | null) ?? null;
  const override = input.override;
  const action = override?.action ?? verdict?.action;
  if (!action) {
    return fail(422, 'nothing_to_act_on', 'This case has no verdict yet. Run the analysis first, or pass an override.');
  }

  const summary = toDisputeSummary(rawDispute ?? { dispute_id: disputeId });
  if (!summary.allowed_actions.includes(action)) {
    return fail(422, 'action_not_allowed', `${action} is not allowed for this dispute right now.`, {
      allowed_actions: summary.allowed_actions,
    });
  }

  const needsHuman = Boolean(override) || Boolean(verdict?.needs_human);
  if (needsHuman && !input.humanApproved) {
    return fail(403, 'human_approval_required', 'A person must approve this action (human_approved: true).');
  }

  // Refunding money the buyer already got back needs an explicit, informed yes.
  if ((action === 'MAKE_OFFER' || action === 'ACCEPT_CLAIM') && found.refunded && !input.confirmRefunded) {
    const r = found.refunded;
    return fail(
      409,
      'already_refunded',
      `The buyer was already refunded ${r.value} ${r.currency}${r.pending ? ' (still pending)' : ''}${r.covers_dispute === 'full' ? ', the full disputed amount' : ''}. ${action === 'ACCEPT_CLAIM' ? 'Accepting the claim' : 'This offer'} may refund them again. Confirm to send it anyway.`,
      r,
    );
  }

  // Offer details come from the override when one is used, otherwise from the verdict. They are never mixed.
  const source = override ?? verdict;
  const offerType = source?.offer_type;
  const offerValue = source?.offer_amount;

  let send: () => Promise<unknown>;
  switch (action) {
    case 'PROVIDE_EVIDENCE':
      send = async () =>
        deps.actions.provideEvidence(
          disputeId,
          buildNote(verdict, 'Evidence from the merchant.'),
          deps.evidenceFiles ? await deps.evidenceFiles(disputeId) : [],
        );
      break;
    case 'SEND_MESSAGE':
      send = async () => {
        // What the buyer reads is always built from the records (mandate, order, payment, refunds) with the PDF attached,
        // never the AI's own reasoning, which is written for the merchant.
        const evidence = deps.evidenceMessage ? await deps.evidenceMessage(disputeId) : null;
        return deps.actions.sendMessage(disputeId, evidence?.text ?? NEUTRAL_MESSAGE, evidence?.files);
      };
      break;
    case 'ACCEPT_CLAIM':
      send = () => deps.actions.acceptClaim(disputeId, buildNote(verdict, 'The merchant accepts this claim.'));
      break;
    case 'MAKE_OFFER': {
      if (!offerType || !offerValue) {
        return fail(422, 'offer_incomplete', 'MAKE_OFFER needs offer_type and offer_amount.');
      }
      if (!summary.offer_types.includes(offerType)) {
        return fail(422, 'offer_type_not_allowed', `Offer type ${offerType} is not allowed for this dispute.`, {
          offer_types: summary.offer_types,
        });
      }
      if (!summary.amount) {
        return fail(422, 'offer_incomplete', 'The dispute has no amount, so the offer currency is unknown.');
      }
      if (toMinor(offerValue) <= 0 || toMinor(offerValue) > toMinor(summary.amount.value)) {
        return fail(422, 'offer_amount_invalid', `Offer amount must be above 0 and at most ${fromMinor(toMinor(summary.amount.value))}.`);
      }
      const amount: Money = { value: offerValue, currency: summary.amount.currency };
      send = () => deps.actions.makeOffer(disputeId, { note: buildNote(verdict, 'Offer from the merchant.'), offerType, amount });
      break;
    }
    case 'NO_ACTION':
      send = async () => undefined; // only the decision is recorded
      break;
  }

  try {
    await send();
  } catch (err) {
    if (err instanceof PayPalError) {
      // PayPal's own message is shown; it never contains our credentials. Include the debug id for support.
      return fail(502, 'paypal_error', `PayPal rejected ${action}: ${err.message}`, {
        debugId: err.debugId,
        paypalName: err.paypalName,
      });
    }
    throw err;
  }

  const updated = await deps.store.markActed(disputeId, {
    action,
    outcome: action === 'NO_ACTION' ? 'Reviewed. No response has been sent to PayPal.' : `${action} submitted to PayPal`,
    humanApproved: input.humanApproved,
    actedBy: input.actedBy,
    // Deciding to do nothing answers nobody: PayPal still waits on the store, so the case stays open.
    close: action !== 'NO_ACTION',
  });
  if (!updated) return fail(409, 'already_acted', `Case ${disputeId} was already acted on.`);
  return { ok: true, row: updated, action };
}
