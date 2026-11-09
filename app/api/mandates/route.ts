import { randomBytes } from 'node:crypto';
import { db, schema } from '@/db/client';
import { apiError } from '@/lib/http';
import { signOpenMandate } from '@/lib/mandate';
import { toMinor } from '@/lib/mandate/money';
import { CreateMandateRequest, type CreateMandateResponse } from '@/contracts/schemas';
import type { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/** How long an open mandate stays usable. */
const MANDATE_TTL_SECONDS = 7 * 24 * 60 * 60;

// OWNER: B. POST { constraints } -> { mandate_id, constraints, expires_at }. Signs and stores the open mandate for the
// signed-in user: their user id is the buyer_ref, whatever the request says.
export async function POST(req: Request) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const body = CreateMandateRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Invalid mandate request', body.error.issues);
  const { constraints } = body.data;
  const buyer_ref = authz.user.id;

  if (toMinor(constraints.max_total.value) <= 0) {
    return apiError(400, 'invalid_constraints', 'max_total must be greater than zero');
  }
  const now = Math.floor(Date.now() / 1000);
  if (constraints.deadline && Date.parse(constraints.deadline) / 1000 <= now) {
    return apiError(400, 'invalid_constraints', 'deadline is already in the past');
  }

  const mandate_id = `mnd_${randomBytes(8).toString('hex')}`;
  const exp = now + MANDATE_TTL_SECONDS;
  const jws = await signOpenMandate({ typ: 'checkout_mandate.open', mandate_id, buyer_ref, constraints, iat: now, exp });

  const expires_at = new Date(exp * 1000).toISOString();
  await db.insert(schema.mandates).values({
    mandateId: mandate_id,
    userId: authz.user.id,
    buyerRef: buyer_ref,
    requestText: constraints.request_text ?? null,
    constraints,
    jws,
    expiresAt: new Date(exp * 1000),
  });

  const response: z.infer<typeof CreateMandateResponse> = { mandate_id, constraints, expires_at };
  return Response.json(response, { status: 201 });
}
