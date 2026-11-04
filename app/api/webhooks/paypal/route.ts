import { notImplemented } from '@/lib/http';

// Signature verification and Postgres access need the Node runtime, so never switch this to Edge.
export const runtime = 'nodejs';

// OWNER: A. Verify the PayPal signature (verify-webhook-signature), store the event once by id,
// return 200 fast, then process CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED in the background.
export async function POST() {
  return notImplemented('A', 'PayPal webhook receiver');
}
