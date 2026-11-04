import { notImplemented } from '@/lib/http';

export const runtime = 'nodejs';

// OWNER: A. POST ActOnCaseRequest. Execute the verdict through the Disputes API (evidence, make offer, accept claim).
// If verdict.needs_human is true, require human_approved: true.
export async function POST() {
  return notImplemented('A', 'Execute the chosen dispute action');
}
