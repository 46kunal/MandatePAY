import { notImplemented } from '@/lib/http';

export const runtime = 'nodejs';

// OWNER: B. POST { buyer_ref, constraints } -> { mandate_id, constraints, expires_at }. Signs and stores the open mandate.
export async function POST() {
  return notImplemented('B', 'Create, sign (Ed25519 JWS) and store an open mandate');
}
