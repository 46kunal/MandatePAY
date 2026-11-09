// OWNER: C. Turns the raw case detail from GET /api/cases/:id into typed mandate / cart / guard data,
// and summarises a mandate in one line. Nothing here invents data: it only reads what the API returned.
import { Cart, Constraints, GuardResult } from '@/contracts/schemas';
import type { CaseDetail } from '@/fixtures';
import { formatDay, formatMoney, titleCase } from './labels';

export interface ParsedCase {
  constraints: Constraints | null;
  cart: Cart | null;
  guard: GuardResult | null;
}

export function parseCase(detail: CaseDetail): ParsedCase {
  const c = Constraints.safeParse(detail.mandate?.constraints);
  const k = Cart.safeParse(detail.cart?.cart);
  const g = GuardResult.safeParse(detail.cart?.guard);
  return { constraints: c.success ? c.data : null, cart: k.success ? k.data : null, guard: g.success ? g.data : null };
}

/** e.g. "Up to $110.00 · trainers · Color: white, Size: 10 · by Nov 20, 2026". */
export function summariseConstraints(c: Constraints): string {
  const parts = [`Up to ${formatMoney(c.max_total.value, c.max_total.currency)}`];
  if (c.categories?.length) parts.push(c.categories.join(', '));
  const attrs = Object.entries(c.required_attributes ?? {});
  if (attrs.length) parts.push(attrs.map(([k, v]) => `${titleCase(k)}: ${v}`).join(', '));
  if (c.max_quantity !== undefined) parts.push(`max ${c.max_quantity}`);
  if (c.deadline) parts.push(`by ${formatDay(c.deadline)}`);
  return parts.join(' · ');
}

export function cartTotal(cart: Cart): string {
  return cart.items.reduce((n, i) => n + Number(i.unit_price) * i.quantity, 0).toFixed(2);
}

export function shortHash(h: string | null | undefined): string {
  if (!h) return '';
  const body = h.replace(/^sha256:/, '');
  return body.length > 16 ? `${body.slice(0, 8)}…${body.slice(-6)}` : body;
}
