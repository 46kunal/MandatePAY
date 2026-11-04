import { notImplemented } from '@/lib/http';

export const runtime = 'nodejs';

// OWNER: B. POST { mandate_id, cart } -> GuardResult. Deterministic rules first; LLM only for fuzzy matches.
export async function POST() {
  return notImplemented('B', 'Cart guard: check a cart against a verified mandate');
}
