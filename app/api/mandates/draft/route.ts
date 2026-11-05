import { LlmError } from '@/lib/ai';
import { apiError } from '@/lib/http';
import { draftMandate } from '@/lib/mandate/draft';
import { DraftMandateRequest } from '@/contracts/schemas';

export const runtime = 'nodejs';

// OWNER: B. POST { request_text } -> { constraints, warnings }. LLM drafts, buyer confirms. See contracts/api.md.
export async function POST(req: Request) {
  const body = DraftMandateRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { request_text: string }', body.error.issues);

  try {
    return Response.json(await draftMandate(body.data.request_text));
  } catch (err) {
    if (err instanceof LlmError) {
      return apiError(err.code === 'config' ? 500 : 502, 'llm_failed', err.message, { code: err.code });
    }
    throw err;
  }
}
