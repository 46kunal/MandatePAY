import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db/client';
import { audit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/guard';
import { apiError } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({ dismissed: z.boolean() }).strict();

// OWNER: A. POST { dismissed: true | false } -> { dispute_id, dismissed_at }. Hides a dispute from every list (an old,
// test or outside dispute that has nothing to do), or brings it back. Nothing is sent to PayPal and the case is kept,
// so a later poll or webhook for it does not bring it back. Store team (cases:act). 404 unknown case.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'cases:act');
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { dismissed: boolean }.', body.error.issues);

  const at = body.data.dismissed ? new Date() : null;
  const updated = await db.update(schema.cases).set({ dismissedAt: at }).where(eq(schema.cases.disputeId, id)).returning({ id: schema.cases.disputeId });
  if (!updated.length) return apiError(404, 'case_not_found', `No case with id ${id}.`);
  await audit(authz.user, { action: body.data.dismissed ? 'case.dismiss' : 'case.restore', targetType: 'case', targetId: id });
  return Response.json({ dispute_id: id, dismissed_at: at ? at.toISOString() : null });
}
