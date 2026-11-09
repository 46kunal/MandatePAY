import { UpdateProductRequest } from '@/contracts/schemas';
import { updateProduct } from '@/lib/catalog/products';
import { apiError } from '@/lib/http';
import { requirePermission } from '@/lib/auth/guard';

export const runtime = 'nodejs';

// PATCH UpdateProductRequest -> Product. Products are never deleted (orders and evidence refer to them); set active=false.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'products:write');
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const body = UpdateProductRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Body does not match UpdateProductRequest.', body.error.issues);
  try {
    const product = await updateProduct(id, body.data);
    if (!product) return apiError(404, 'product_not_found', `No product with id ${id}.`);
    return Response.json(product);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return apiError(409, 'sku_taken', 'Another product already uses that SKU.');
    throw err;
  }
}
