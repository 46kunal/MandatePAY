import { apiError } from '@/lib/http';
import { checkCartById } from '@/lib/mandate/check';
import { CartCheckRequest } from '@/contracts/schemas';

export const runtime = 'nodejs';

// OWNER: B. POST { mandate_id, cart } -> GuardResult. 404 unknown mandate, 410 expired.
// Deterministic rules first; LLM only for fuzzy matches (B7). Person A should call checkCartById() directly.
export async function POST(req: Request) {
  const body = CartCheckRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { mandate_id, cart }', body.error.issues);

  const result = await checkCartById(body.data.mandate_id, body.data.cart);
  if (!result.ok) return apiError(result.status, result.error, result.message);
  return Response.json(result.guard);
}
