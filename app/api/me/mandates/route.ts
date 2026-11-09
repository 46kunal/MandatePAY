import type { ListMyMandatesResponse } from '@/contracts/schemas';
import { requirePermission } from '@/lib/auth/guard';
import { listMyMandates } from '@/lib/myData';
import type { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> ListMyMandatesResponse: the signed-in buyer's own mandates, newest first, with status and order counts.
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const body: z.infer<typeof ListMyMandatesResponse> = { mandates: await listMyMandates(authz.user.id) };
  return Response.json(body);
}
