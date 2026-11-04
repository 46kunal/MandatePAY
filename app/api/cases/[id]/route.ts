import { notImplemented } from '@/lib/http';

export const runtime = 'nodejs';

// OWNER: A. GET -> CaseRecord plus the linked mandate, cart and order for the detail view.
export async function GET() {
  return notImplemented('A', 'Case detail with mandate, cart and order');
}
