import { after } from 'next/server';
import { autoAnalysePending } from '@/lib/analyst/runCase';
import { apiError } from '@/lib/http';
import { PayPalConfigError, PayPalError, getPayPalClient, showDispute, verifyWebhookSignature } from '@/lib/paypal';
import { drizzleDisputeStore } from '@/lib/paypal/deps';
import { handleWebhook } from '@/lib/paypal/webhookService';

// Signature verification and Postgres access need the Node runtime, so never switch this to Edge.
export const runtime = 'nodejs';
// The answer to PayPal goes out first; auto-analysis runs after it (AI calls, up to about two minutes).
export const maxDuration = 300;

// OWNER: A. Verifies the PayPal signature (verify-webhook-signature), stores the event once by id and ingests the
// dispute for CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED. 400 bad signature, 502 PayPal, 500 not configured.
// Polling (POST /api/disputes/poll) works without webhooks; this route only makes updates arrive sooner.
export async function POST(req: Request) {
  const rawBody = await req.text();
  try {
    const client = getPayPalClient();
    const result = await handleWebhook(
      {
        store: drizzleDisputeStore(),
        verify: (headers, event) => verifyWebhookSignature(client, headers, event),
        showDispute: (id) => showDispute(client, id),
      },
      req.headers,
      rawBody,
    );
    if (!result.ok) return apiError(result.httpStatus, result.error, result.message);
    // New or updated disputes are analysed once PayPal has its answer, so it never waits on the AI.
    if (result.handled === 'processed') after(() => autoAnalysePending().then(() => undefined));
    return Response.json({ ok: true, handled: result.handled });
  } catch (err) {
    if (err instanceof PayPalConfigError) return apiError(500, 'paypal_not_configured', err.message);
    // PayPal retries on a non-2xx answer, which is what we want when our own PayPal call failed.
    if (err instanceof PayPalError) return apiError(502, 'paypal_error', err.message, { debugId: err.debugId });
    throw err;
  }
}
