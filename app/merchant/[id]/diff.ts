// OWNER: C. Builds the mandate-vs-cart comparison shown on the case detail page.
// Status comes from the guard result stored with the cart; per-attribute rows are compared locally so the
// merchant can see exactly which detail (colour, size, ...) did not match.
import type { Cart, Constraints, GuardCheck, GuardResult } from '@/contracts/schemas';
import { formatMoney, ruleLabel } from '../../_ui/labels';

export type DiffStatus = GuardCheck['status'];

export interface DiffRow {
  key: string;
  label: string;
  mandate: string;
  cart: string;
  status: DiffStatus;
  /** The guard's own explanation, when it has one. */
  note?: string;
}

const lower = (s: string) => s.trim().toLowerCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// UTC so a deadline of "Nov 20" never shows as Nov 21 in a timezone ahead of UTC.
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function findCheck(guard: GuardResult | null, ...rules: string[]): GuardCheck | undefined {
  return guard?.checks.find((c) => rules.includes(c.rule));
}

/** Rows in a fixed, readable order. Rules the mandate does not set are left out. */
export function buildDiff(constraints: Constraints, cart: Cart, guard: GuardResult | null): DiffRow[] {
  const rows: DiffRow[] = [];
  const total = guard?.total ?? cart.items.reduce((n, i) => n + Number(i.unit_price) * i.quantity, 0).toFixed(2);

  const max = findCheck(guard, 'max_total');
  rows.push({
    key: 'max_total',
    label: ruleLabel('max_total'),
    mandate: `Up to ${formatMoney(constraints.max_total.value, constraints.max_total.currency)}`,
    cart: formatMoney(total, cart.currency),
    status: max?.status ?? (Number(total) <= Number(constraints.max_total.value) ? 'pass' : 'fail'),
    note: max?.detail,
  });

  if (constraints.categories?.length) {
    const c = findCheck(guard, 'categories');
    const cats = [...new Set(cart.items.map((i) => i.category).filter(Boolean))] as string[];
    const allowed = new Set(constraints.categories.map(lower));
    rows.push({
      key: 'categories',
      label: ruleLabel('categories'),
      mandate: constraints.categories.join(', '),
      cart: cats.length ? cats.join(', ') : 'Not listed',
      status: c?.status ?? (!cats.length ? 'unsure' : cats.every((x) => allowed.has(lower(x))) ? 'pass' : 'fail'),
      note: c?.detail,
    });
  }

  if (constraints.max_quantity !== undefined) {
    const c = findCheck(guard, 'max_quantity');
    const qty = cart.items.reduce((n, i) => n + i.quantity, 0);
    rows.push({
      key: 'max_quantity',
      label: ruleLabel('max_quantity'),
      mandate: `At most ${constraints.max_quantity}`,
      cart: String(qty),
      status: c?.status ?? (qty <= constraints.max_quantity ? 'pass' : 'fail'),
      note: c?.detail,
    });
  }

  for (const [key, want] of Object.entries(constraints.required_attributes ?? {})) {
    const got = [
      ...new Set(
        cart.items.map((i) => Object.entries(i.attributes ?? {}).find(([k]) => lower(k) === lower(key))?.[1]),
      ),
    ];
    const missing = got.some((g) => g === undefined);
    const mismatch = got.some((g) => g !== undefined && lower(g) !== lower(want));
    rows.push({
      key: `attr_${key}`,
      label: cap(key),
      mandate: want,
      cart: got.filter((g): g is string => g !== undefined).join(', ') || 'Not listed',
      status: mismatch ? 'fail' : missing ? 'unsure' : 'pass',
      note: missing && !mismatch ? findCheck(guard, 'required_attributes')?.detail : undefined,
    });
  }

  if (constraints.deadline) {
    const c = findCheck(guard, 'deadline');
    rows.push({
      key: 'deadline',
      label: ruleLabel('deadline'),
      mandate: `By ${day(constraints.deadline)}`,
      cart: cart.delivery_eta ? `Estimated ${day(cart.delivery_eta)}` : 'No estimate',
      status:
        c?.status ??
        (!cart.delivery_eta ? 'unsure' : Date.parse(cart.delivery_eta) <= Date.parse(constraints.deadline) ? 'pass' : 'fail'),
      note: c?.detail,
    });
  }

  if (constraints.require_approval_over) {
    const c = findCheck(guard, 'approval_threshold', 'require_approval_over');
    rows.push({
      key: 'approval',
      label: ruleLabel('approval_threshold'),
      mandate: `Ask me above ${formatMoney(constraints.require_approval_over, constraints.max_total.currency)}`,
      cart: formatMoney(total, cart.currency),
      status: c?.status ?? (Number(total) > Number(constraints.require_approval_over) ? 'escalate' : 'pass'),
      note: c?.detail,
    });
  }

  return rows;
}

/** One-line summary above the table, e.g. "2 of 6 checks failed". */
export function summarise(rows: DiffRow[]): { text: string; tone: 'good' | 'bad' | 'warn' } {
  const failed = rows.filter((r) => r.status === 'fail').length;
  const open = rows.filter((r) => r.status === 'unsure' || r.status === 'escalate').length;
  if (failed) return { text: `${failed} of ${rows.length} checks failed: the cart broke the mandate.`, tone: 'bad' };
  if (open) {
    return { text: `Nothing broke the mandate, but ${open} check${open === 1 ? '' : 's'} could not be confirmed or needed the buyer's approval.`, tone: 'warn' };
  }
  return { text: `All ${rows.length} checks passed: the cart fit the mandate exactly.`, tone: 'good' };
}
