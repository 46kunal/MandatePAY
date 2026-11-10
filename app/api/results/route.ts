import { requirePermission } from '@/lib/auth/guard';
import { loadResults } from '@/lib/results';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> ResultsResponse: what MandatePay did (disputes, people and the AI, speed, the cart guard, buyer reports,
// refunds, the analyst's test-set accuracy). Store team (cases:read).
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'cases:read');
  if (!authz.ok) return authz.response;
  return Response.json(await loadResults());
}
