/**
 * What buyers may see of the catalog (owner: orchestrator). Only active, in-stock products. The buyer gets an
 * availability word and a per-order limit, never the stock count, and nothing about the store's inventory.
 */
import type { BuyerProduct } from '../../contracts/schemas';
import { toProduct, type ProductRow } from './products';

/** The most one buyer can add of one product in a single order. */
export const MAX_PER_ORDER = 10;
/** At or below this many left, the buyer is told it is running low. */
export const LOW_STOCK_AT = 5;

export function toBuyerProduct(row: ProductRow, storeName = 'MandatePay Store'): BuyerProduct {
  const p = toProduct(row);
  return {
    sku: p.sku,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    category: p.category,
    unit_price: p.unit_price,
    currency: p.currency,
    attributes: p.attributes,
    delivery_days: p.delivery_days,
    ...(p.image_url ? { image_url: p.image_url } : {}),
    seller: p.seller ?? storeName,
    availability: p.stock <= LOW_STOCK_AT ? 'low_stock' : 'in_stock',
    max_quantity: Math.max(1, Math.min(p.stock, MAX_PER_ORDER)),
  };
}

export async function listShopProducts(currency?: string): Promise<BuyerProduct[]> {
  const [{ and, asc, eq, gt }, { db, schema }, { getSettings }] = await Promise.all([import('drizzle-orm'), import('../../db/client'), import('../settings')]);
  const storeName = (await getSettings()).store_name?.trim() || 'MandatePay Store';
  const conds = [eq(schema.products.active, true), gt(schema.products.stock, 0)];
  if (currency) conds.push(eq(schema.products.currency, currency));
  const rows = await db
    .select()
    .from(schema.products)
    .where(and(...conds))
    .orderBy(asc(schema.products.name));
  return rows.map((r) => toBuyerProduct(r as ProductRow, storeName));
}
