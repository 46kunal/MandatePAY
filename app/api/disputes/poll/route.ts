import { notImplemented } from '@/lib/http';

export const runtime = 'nodejs';

// OWNER: A. POST -> PollDisputesResponse. The MAIN way disputes enter the system (works without webhooks/ngrok).
// List disputes, fetch details, upsert cases, link to orders by capture_id.
export async function POST() {
  return notImplemented('A', 'Poll the PayPal Disputes API and upsert cases');
}
