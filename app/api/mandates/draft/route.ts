import { notImplemented } from '@/lib/http';

export const runtime = 'nodejs';

// OWNER: B. POST { request_text } -> { constraints, warnings }. LLM drafts, buyer confirms. See contracts/api.md.
export async function POST() {
  return notImplemented('B', 'Mandate builder: free text to Constraints, validated with Zod');
}
