import type { PollDisputesResponse } from '@/contracts/schemas';
import { apiError } from '@/lib/http';
import { PayPalConfigError, PayPalError } from '@/lib/paypal';
import { defaultPollDeps } from '@/lib/paypal/deps';
import { pollDisputes } from '@/lib/paypal/disputeService';
import type { z } from 'zod';

export const runtime = 'nodejs';

// OWNER: A. POST -> PollDisputesResponse. The MAIN way disputes enter the system (works without webhooks/ngrok).
// Lists disputes, fetches the ones that changed, upserts cases, links them to orders by capture_id.
export async function POST() {
  try {
    const r = await pollDisputes(defaultPollDeps());
    const response: z.infer<typeof PollDisputesResponse> = { fetched: r.fetched, new_cases: r.newCases, linked: r.linked };
    return Response.json(response);
  } catch (err) {
    if (err instanceof PayPalConfigError) return apiError(500, 'paypal_not_configured', err.message);
    if (err instanceof PayPalError) return apiError(502, 'paypal_error', err.message, { debugId: err.debugId });
    throw err;
  }
}
