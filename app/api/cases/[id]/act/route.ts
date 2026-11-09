import { ActOnCaseRequest } from '@/contracts/schemas';
import { apiError } from '@/lib/http';
import { PayPalConfigError } from '@/lib/paypal';
import { actOnCase } from '@/lib/paypal/caseActions';
import { toCaseRecord } from '@/lib/paypal/cases';
import { defaultActDeps } from '@/lib/paypal/deps';
import { authorize, requirePermission } from '@/lib/auth/guard';

export const runtime = 'nodejs';
// Builds the evidence PDF and calls PayPal.
export const maxDuration = 60;

// OWNER: A. POST ActOnCaseRequest -> updated CaseRecord. Executes the verdict (or the override) through the
// Disputes API. 404 unknown case, 409 already acted, 422 action/offer not allowed, 403 needs human approval, 502 PayPal.
// Staff may send a verdict that needs no person. Approving (human_approved) or overriding the AI needs an owner.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'cases:act');
  if (!authz.ok) return authz.response;
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

  if (parsed.data.human_approved || parsed.data.override) {
    const approver = authorize(authz.user, 'cases:approve');
    if (!approver.ok) return approver.response;
  }

  try {
    const result = await actOnCase(defaultActDeps(), id, {
      humanApproved: parsed.data.human_approved,
      override: parsed.data.override,
      actedBy: authz.user.id,
    });
    if (!result.ok) return apiError(result.httpStatus, result.error, result.message, result.details);
    return Response.json(toCaseRecord(result.row));
  } catch (err) {
    if (err instanceof PayPalConfigError) return apiError(500, 'paypal_not_configured', err.message);
    throw err;
  }
}
