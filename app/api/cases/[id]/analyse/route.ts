import { notImplemented } from '@/lib/http';

export const runtime = 'nodejs';

// OWNER: B. POST -> Verdict, saved on the case. Input: DisputeSummary + mandate + cart + tracking.
// The analyst may only choose actions listed in DisputeSummary.allowed_actions.
export async function POST() {
  return notImplemented('B', 'Case analyst');
}
