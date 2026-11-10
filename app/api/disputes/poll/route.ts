import { PollDisputesRequest, type PollDisputesResponse } from '@/contracts/schemas';
import { after } from 'next/server';
import { autoAnalysePending } from '@/lib/analyst/runCase';
import { apiError } from '@/lib/http';
import { PayPalConfigError, PayPalError } from '@/lib/paypal';
import { defaultPollDeps } from '@/lib/paypal/deps';
import { fetchDisputeById, pollDisputes } from '@/lib/paypal/disputeService';
import type { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';

export const runtime = 'nodejs';
// Auto-analysis of newly arrived disputes runs after the answer (AI calls).
export const maxDuration = 300;

// OWNER: A. POST -> PollDisputesResponse. The MAIN way disputes enter the system (works without webhooks/ngrok).
// Lists disputes, fetches the ones that changed, upserts cases, links them to orders by capture_id.
// With { dispute_id } it fetches that one dispute instead: PayPal's list can take a while to show a new dispute.
export async function POST(req: Request) {
  const authz = await requirePermission(req, 'disputes:poll');
  if (!authz.ok) return authz.response;
  const text = await req.text();
  let disputeId: string | undefined;
  if (text.trim()) {
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* invalid JSON fails validation below */
    }
    const body = PollDisputesRequest.safeParse(json);
    if (!body.success) return apiError(400, 'invalid_request', 'Expected no body or { dispute_id }', body.error.issues);
    disputeId = body.data.dispute_id;
  }
  try {
    const deps = defaultPollDeps();
    const r = disputeId ? await fetchDisputeById(deps, disputeId) : await pollDisputes(deps);
    const response: z.infer<typeof PollDisputesResponse> = { fetched: r.fetched, new_cases: r.newCases, linked: r.linked };
    // Disputes that are now linked and actionable are analysed after this answer goes out.
    after(() => autoAnalysePending().then(() => undefined));
    return Response.json(response);
  } catch (err) {
    if (err instanceof PayPalConfigError) return apiError(500, 'paypal_not_configured', err.message);
    if (err instanceof PayPalError && err.status === 404 && disputeId) {
      return apiError(404, 'dispute_not_found', `PayPal has no dispute ${disputeId} for this merchant.`);
    }
    if (err instanceof PayPalError) return apiError(502, 'paypal_error', err.message, { debugId: err.debugId });
    throw err;
  }
}
