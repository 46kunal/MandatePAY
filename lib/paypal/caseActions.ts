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
import { toDisputeSummary, type RawDispute } from './disputes';
import { PayPalError } from './errors';
import { fromMinor, toMinor } from './orders';

export interface ActInput {
  humanApproved: boolean;
  override?: { action: ActionType; offer_type?: OfferType; offer_amount?: string };
}

export interface ActCase {
  row: CaseRow;
  /** Latest raw dispute stored by the poller / webhook. Source of allowed actions and offer types. */
  rawDispute: RawDispute | null;
}

export interface ActStore {
  getCase(disputeId: string): Promise<ActCase | undefined>;
  /**
   * Atomically mark the case acted. Returns the updated row, or undefined when it was already acted
   * (a concurrent request won), so the caller can answer 409.
   */
  markActed(
    disputeId: string,
    fields: { action: ActionType; outcome: string; humanApproved: boolean },
  ): Promise<CaseRow | undefined>;
}

export interface DisputeActions {
  provideEvidence(disputeId: string, notes: string): Promise<unknown>;
  makeOffer(disputeId: string, offer: { note: string; offerType: OfferType; amount: Money }): Promise<unknown>;
  acceptClaim(disputeId: string, note: string): Promise<unknown>;
  sendMessage(disputeId: string, message: string): Promise<unknown>;
}

export interface ActDeps {
  store: ActStore;
  actions: DisputeActions;
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

/** Text sent to PayPal, built only from the verdict (the merchant-facing claims and their cited sources). */
export function buildNote(verdict: Verdict | null, fallback: string): string {
  if (!verdict) return fallback;
  const points = verdict.evidence_points.map((p, i) => `${i + 1}. ${p.claim} (source: ${p.source})`);
  const text = [verdict.reasoning, ...points].filter(Boolean).join('\n');
  return (text || fallback).slice(0, MAX_NOTE);
}

export async function actOnCase(deps: ActDeps, disputeId: string, input: ActInput): Promise<ActResult> {
  const found = await deps.store.getCase(disputeId);
  if (!found) return fail(404, 'case_not_found', `No case with id ${disputeId}.`);
  const { row, rawDispute } = found;

  if (row.analysisStatus === 'acted') {
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

  // Offer details come from the override when one is used, otherwise from the verdict. They are never mixed.
  const source = override ?? verdict;
  const offerType = source?.offer_type;
  const offerValue = source?.offer_amount;

  let send: () => Promise<unknown>;
  switch (action) {
    case 'PROVIDE_EVIDENCE':
      send = () => deps.actions.provideEvidence(disputeId, buildNote(verdict, 'Evidence from the merchant.'));
      break;
    case 'SEND_MESSAGE':
      send = () => deps.actions.sendMessage(disputeId, buildNote(verdict, 'Message from the merchant.'));
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
    outcome: action === 'NO_ACTION' ? 'No action taken' : `${action} submitted to PayPal`,
    humanApproved: input.humanApproved,
  });
  if (!updated) return fail(409, 'already_acted', `Case ${disputeId} was already acted on.`);
  return { ok: true, row: updated, action };
}
