import { notImplemented } from '@/lib/http';

export const runtime = 'nodejs';

// OWNER: A. POST -> CaptureOrderResponse. Capture with PayPal-Request-Id, store capture_id and receipt_hash.
export async function POST() {
  return notImplemented('A', 'Capture the approved PayPal order and write the ledger row');
}
