import { CreateReportRequest } from '@/contracts/schemas';
import { requirePermission } from '@/lib/auth/guard';
import { limited } from '@/lib/rateLimit';
import { apiError } from '@/lib/http';
import { createReport } from '@/lib/reports/reports';

export const runtime = 'nodejs';

// POST CreateReportRequest -> ProblemReport (201). The buyer reports a problem with one of their own paid orders.
// 404 not their order, 409 not paid / a report is already open.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const slow = limited(authz.user.id, 'report', 5);
  if (slow) return slow;
  const { id } = await ctx.params;
  const body = CreateReportRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Pick what went wrong and describe it in a few words (5 to 1000 characters).', body.error.issues);
  const r = await createReport(authz.user, id, body.data.kind, body.data.message);
  if (!r.ok) return apiError(r.status, r.error, r.message);
  return Response.json(r.report, { status: 201 });
}
