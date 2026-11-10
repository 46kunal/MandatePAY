import type { ListMyOrdersResponse } from '@/contracts/schemas';
import { requirePermission } from '@/lib/auth/guard';
import { listMyOrders } from '@/lib/reports/reports';
import type { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> ListMyOrdersResponse: the signed-in buyer's own paid orders, newest first, each with its latest problem report.
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const body: z.infer<typeof ListMyOrdersResponse> = { orders: await listMyOrders(authz.user.id) };
  return Response.json(body);
}
