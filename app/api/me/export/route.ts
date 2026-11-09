import { requirePermission } from '@/lib/auth/guard';
import { exportMyData } from '@/lib/myData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> application/json download of everything stored about the signed-in person: account, mandates, carts, orders.
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const data = await exportMyData(authz.user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="mandatepay-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
