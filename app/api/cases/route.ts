import { listCaseRecords } from '@/lib/paypal/cases';
import { requirePermission } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OWNER: A. GET -> CaseRecord[] (newest first). Read by the merchant UI (C).
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'cases:read');
  if (!authz.ok) return authz.response;
  return Response.json(await listCaseRecords());
}
