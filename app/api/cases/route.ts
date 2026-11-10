import { listCaseRecords } from '@/lib/paypal/cases';
import { requirePermission } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OWNER: A. GET -> CaseRecord[] (newest first, dismissed ones left out). ?dismissed=1 returns only the dismissed ones.
// Read by the merchant UI (C).
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'cases:read');
  if (!authz.ok) return authz.response;
  return Response.json(await listCaseRecords({ dismissed: new URL(req.url).searchParams.get('dismissed') === '1' }));
}
