import type { ShopCatalogResponse } from '@/contracts/schemas';
import { requirePermission } from '@/lib/auth/guard';
import { listShopProducts } from '@/lib/catalog/shop';
import { getSettings } from '@/lib/settings';
import type { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?currency=USD -> ShopCatalogResponse: what a buyer may browse. Active, in-stock products with a picture, price,
// seller name and an availability word. No stock counts and no store-only fields.
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const currency = new URL(req.url).searchParams.get('currency') || undefined;
  const [products, settings] = await Promise.all([listShopProducts(currency), getSettings()]);
  const body: z.infer<typeof ShopCatalogResponse> = { seller: settings.store_name?.trim() || 'MandatePay Store', products };
  return Response.json(body);
}
