/**
 * Merchant catalog. Products live in Postgres and are entered by the merchant on /merchant/products (or through
 * POST /api/products). The shopping agent may only choose from active, in-stock products.
 */
import { randomBytes } from 'node:crypto';
import type { Product, ProductInput } from '../../contracts/schemas';
import { fromMinor, toMinor } from '../mandate/money';

export interface ProductRow {
  productId: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  unitPriceMinor: number;
  currency: string;
  attributes: Record<string, string>;
  stock: number;
  deliveryDays: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toProduct(r: ProductRow): Product {
  return {
    product_id: r.productId,
    sku: r.sku,
    name: r.name,
    ...(r.description ? { description: r.description } : {}),
    category: r.category,
    unit_price: fromMinor(r.unitPriceMinor),
    currency: r.currency,
    attributes: r.attributes ?? {},
    stock: r.stock,
    delivery_days: r.deliveryDays,
    active: r.active,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

/** Normalise what the merchant typed: trimmed, lower-case attribute keys and values (the guard compares case-insensitively). */
export function rowFromInput(input: ProductInput): Omit<ProductRow, 'productId' | 'active' | 'createdAt' | 'updatedAt'> {
  return {
    sku: input.sku.trim(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    category: input.category.trim().toLowerCase(),
    unitPriceMinor: toMinor(input.unit_price),
    currency: input.currency,
    attributes: Object.fromEntries(
      Object.entries(input.attributes ?? {})
        .map(([k, v]) => [k.trim().toLowerCase(), v.trim()] as const)
        .filter(([k, v]) => k && v),
    ),
    stock: input.stock,
    deliveryDays: input.delivery_days,
  };
}

const load = async () => {
  const [{ and, asc, eq, gt }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  return { and, asc, eq, gt, db, schema };
};

export async function listProducts(opts: { activeOnly?: boolean } = {}): Promise<Product[]> {
  const { asc, eq, db, schema } = await load();
  const q = db.select().from(schema.products);
  const rows = opts.activeOnly
    ? await q.where(eq(schema.products.active, true)).orderBy(asc(schema.products.name))
    : await q.orderBy(asc(schema.products.name));
  return rows.map((r) => toProduct(r as ProductRow));
}

/** Active, in-stock products in one currency: what the agent is allowed to buy. */
export async function listBuyableProducts(currency: string): Promise<ProductRow[]> {
  const { and, asc, eq, gt, db, schema } = await load();
  const rows = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.active, true), gt(schema.products.stock, 0), eq(schema.products.currency, currency)))
    .orderBy(asc(schema.products.unitPriceMinor));
  return rows as ProductRow[];
}

export type CreateResult = { ok: true; product: Product } | { ok: false; status: 409; error: 'sku_taken'; message: string };

export async function createProduct(input: ProductInput): Promise<CreateResult> {
  const { eq, db, schema } = await load();
  const values = rowFromInput(input);
  const [existing] = await db.select({ id: schema.products.productId }).from(schema.products).where(eq(schema.products.sku, values.sku)).limit(1);
  if (existing) return { ok: false, status: 409, error: 'sku_taken', message: `A product with SKU ${values.sku} already exists.` };
  const [row] = await db
    .insert(schema.products)
    .values({ ...values, productId: `prd_${randomBytes(6).toString('hex')}` })
    .returning();
  return { ok: true, product: toProduct(row as ProductRow) };
}

export async function updateProduct(productId: string, patch: Partial<ProductInput> & { active?: boolean }): Promise<Product | undefined> {
  const { eq, db, schema } = await load();
  const [current] = await db.select().from(schema.products).where(eq(schema.products.productId, productId)).limit(1);
  if (!current) return undefined;
  const merged = { ...toProduct(current as ProductRow), ...patch };
  const values = rowFromInput(merged);
  const [row] = await db
    .update(schema.products)
    .set({ ...values, active: patch.active ?? current.active, updatedAt: new Date() })
    .where(eq(schema.products.productId, productId))
    .returning();
  return toProduct(row as ProductRow);
}
