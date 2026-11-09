import { ActOnCaseRequest } from '@/contracts/schemas';
import { apiError } from '@/lib/http';
import { actOnCase } from '@/lib/paypal/caseActions';
import { toCaseRecord } from '@/lib/paypal/cases';
import { demoActDeps, requireSimulation } from '../../../_demo';

export const runtime = 'nodejs';

// OWNER: C. Demo twin of POST /api/cases/:id/act (A). Same checks (404, 409, 403, 422); the PayPal call is skipped
// but the case is really marked as acted in the database.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = requireSimulation();
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const text = await req.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    return apiError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
  const parsed = ActOnCaseRequest.safeParse(json);
  if (!parsed.success) return apiError(400, 'invalid_request', 'Body does not match ActOnCaseRequest.', parsed.error.issues);

  const result = await actOnCase(demoActDeps(), id, {
    humanApproved: parsed.data.human_approved,
    override: parsed.data.override,
  });
  if (!result.ok) return apiError(result.httpStatus, result.error, result.message, result.details);
  return Response.json(toCaseRecord(result.row));
}
