import { ResolveReportRequest } from '@/contracts/schemas';
import { authorize, requirePermission } from '@/lib/auth/guard';
import { apiError } from '@/lib/http';
import { PayPalConfigError, PayPalError } from '@/lib/paypal';
import { refundOrder } from '@/lib/paypal/refundOrder';
import { getReport, markResolved } from '@/lib/reports/reports';

export const runtime = 'nodejs';

// POST ResolveReportRequest -> { report_id, status, refund? }. Answers a buyer's problem report.
// outcome "close": a reply only (cases:act). outcome "refund": money back through PayPal first (orders:refund, owner or
// admin), then the reply. 404 report, 409 already answered, plus the refund errors of POST /api/orders/:id/refund.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'cases:act');
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const body = ResolveReportRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { outcome, reply, amount?, idempotency_key }.', body.error.issues);
  const report = await getReport(id);
  if (!report) return apiError(404, 'report_not_found', `No report with id ${id}.`);
  if (report.status !== 'open') return apiError(409, 'already_answered', 'This report was already answered.');

  if (body.data.outcome === 'close') {
    const done = await markResolved(authz.user, id, { status: 'closed', reply: body.data.reply });
    if (!done) return apiError(409, 'already_answered', 'This report was already answered.');
    return Response.json({ report_id: id, status: 'closed' });
  }

  const canRefund = authorize(authz.user, 'orders:refund');
  if (!canRefund.ok) return canRefund.response;
  try {
    const r = await refundOrder(authz.user, report.paypalOrderId, {
      amount: body.data.amount,
      note: body.data.reply.slice(0, 255),
      idempotencyKey: body.data.idempotency_key,
      reason: `report ${id}`,
    });
    if (!r.ok) return apiError(r.status, r.error, r.message);
    await markResolved(authz.user, id, { status: 'refunded', reply: body.data.reply, refundId: r.response.refund_id, refundMinor: r.amountMinor });
    return Response.json({ report_id: id, status: 'refunded', refund: r.response });
  } catch (err) {
    if (err instanceof PayPalConfigError) return apiError(500, 'paypal_not_configured', err.message);
    if (err instanceof PayPalError) return apiError(502, 'paypal_error', `PayPal refused the refund: ${err.message}`, { debugId: err.debugId });
    throw err;
  }
}
