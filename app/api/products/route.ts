import { ProductInput } from '@/contracts/schemas';
import { createProduct, listProducts } from '@/lib/catalog/products';
import { apiError } from '@/lib/http';
import { requirePermission } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> Product[] (all, or ?active=1 for what the agent can see). POST ProductInput -> Product (201). 409 duplicate SKU.
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'products:read');
  if (!authz.ok) return authz.response;
  const activeOnly = new URL(req.url).searchParams.get('active') === '1';
  return Response.json(await listProducts({ activeOnly }));
}

export async function POST(req: Request) {
  const authz = await requirePermission(req, 'products:write');
  if (!authz.ok) return authz.response;
  const body = ProductInput.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Body does not match ProductInput.', body.error.issues);
  const r = await createProduct(body.data);
  if (!r.ok) return apiError(r.status, r.error, r.message);
  return Response.json(r.product, { status: 201 });
}
