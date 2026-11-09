// OWNER: C. Builds the mandate-vs-cart comparison shown on the case detail page.
// Status comes from the guard result stored with the cart; attribute rows are compared locally so the merchant can
// see exactly which detail (colour, size, ...) did not match. "Why it matters" is fixed explanatory copy per rule.
import type { Cart, Constraints, GuardCheck, GuardResult } from '@/contracts/schemas';
import { formatDay, formatMoney, ruleLabel, titleCase } from '../../../_ui/labels';

export type DiffStatus = GuardCheck['status'];

export interface DiffRow {
  key: string;
  label: string;
  /** What the buyer authorised. */
  mandate: string;
  /** What the agent actually bought. */
  cart: string;
  status: DiffStatus;
  /** The guard's own explanation, when it has one. */
  note?: string;
  /** Plain-English reason this row matters. Only set when the row is not a pass. */
  why?: string;
}

const lower = (s: string) => s.trim().toLowerCase();

function findCheck(guard: GuardResult | null, ...rules: string[]): GuardCheck | undefined {
  return guard?.checks.find((c) => rules.includes(c.rule));
}

const WHY: Record<string, Partial<Record<DiffStatus, string>>> = {
  max_total: { fail: 'The agent spent more than the buyer allowed, so this purchase was never authorised.' },
  categories: {
    fail: 'The agent bought a different type of product from the one the buyer asked for.',
    unsure: 'The listing did not state a category, so the system could not confirm the product type.',
  },
  max_quantity: { fail: 'The agent bought more items than the buyer approved.' },
  attributes: {
    fail: 'The item does not match what the buyer specified, so they received something they did not ask for.',
    unsure: 'The listing did not state this detail, so the system could not confirm the item matched. The agent should have checked first.',
  },
  deadline: {
    fail: 'Delivery is promised after the buyer’s deadline, so the item may arrive too late to be useful.',
    unsure: 'The listing had no delivery estimate, so the deadline could not be checked.',
  },
  approval: { escalate: 'The total was above the buyer’s approval limit, so the buyer had to approve this purchase themselves.' },
};

function why(key: string, status: DiffStatus): string | undefined {
  return status === 'pass' ? undefined : WHY[key]?.[status];
}

/** Rows in a fixed, readable order. Rules the mandate does not set are left out. */
export function buildDiff(constraints: Constraints, cart: Cart, guard: GuardResult | null): DiffRow[] {
  const rows: DiffRow[] = [];
  const total = guard?.total ?? cart.items.reduce((n, i) => n + Number(i.unit_price) * i.quantity, 0).toFixed(2);

  const max = findCheck(guard, 'max_total');
  const maxStatus: DiffStatus = max?.status ?? (Number(total) <= Number(constraints.max_total.value) ? 'pass' : 'fail');
  rows.push({
    key: 'max_total',
    label: ruleLabel('max_total'),
    mandate: `Up to ${formatMoney(constraints.max_total.value, constraints.max_total.currency)}`,
    cart: formatMoney(total, cart.currency),
    status: maxStatus,
    note: max?.detail,
    why: why('max_total', maxStatus),
  });

  if (constraints.categories?.length) {
    const c = findCheck(guard, 'categories');
    const cats = [...new Set(cart.items.map((i) => i.category).filter(Boolean))] as string[];
    const allowed = new Set(constraints.categories.map(lower));
    const status: DiffStatus = c?.status ?? (!cats.length ? 'unsure' : cats.every((x) => allowed.has(lower(x))) ? 'pass' : 'fail');
    rows.push({
      key: 'categories',
      label: ruleLabel('categories'),
      mandate: constraints.categories.join(', '),
      cart: cats.length ? cats.join(', ') : 'Not listed',
      status,
      note: c?.detail,
      why: why('categories', status),
    });
  }

  const required = Object.entries(constraints.required_attributes ?? {});
  if (required.length) {
    let missing = false;
    let mismatch = false;
    const bought: string[] = [];
    for (const [key, want] of required) {
      const got = [
        ...new Set(cart.items.map((i) => Object.entries(i.attributes ?? {}).find(([k]) => lower(k) === lower(key))?.[1])),
      ];
      if (got.some((g) => g === undefined)) missing = true;
      if (got.some((g) => g !== undefined && lower(g) !== lower(want))) mismatch = true;
      bought.push(`${titleCase(key)}: ${got.filter((g): g is string => g !== undefined).join(', ') || 'not listed'}`);
    }
    const status: DiffStatus = mismatch ? 'fail' : missing ? 'unsure' : 'pass';
    rows.push({
      key: 'attributes',
      label: ruleLabel('required_attributes'),
      mandate: required.map(([k, v]) => `${titleCase(k)}: ${v}`).join(' · '),
      cart: bought.join(' · '),
      status,
      note: findCheck(guard, 'required_attributes')?.detail,
      why: why('attributes', status),
    });
  }

  if (constraints.max_quantity !== undefined) {
    const c = findCheck(guard, 'max_quantity');
    const qty = cart.items.reduce((n, i) => n + i.quantity, 0);
    const status: DiffStatus = c?.status ?? (qty <= constraints.max_quantity ? 'pass' : 'fail');
    rows.push({
      key: 'max_quantity',
      label: ruleLabel('max_quantity'),
      mandate: `At most ${constraints.max_quantity}`,
      cart: String(qty),
      status,
      note: c?.detail,
      why: why('max_quantity', status),
    });
  }

  if (constraints.deadline) {
    const c = findCheck(guard, 'deadline');
    const status: DiffStatus =
      c?.status ??
      (!cart.delivery_eta ? 'unsure' : Date.parse(cart.delivery_eta) <= Date.parse(constraints.deadline) ? 'pass' : 'fail');
    rows.push({
      key: 'deadline',
      label: ruleLabel('deadline'),
      mandate: `Deliver by ${formatDay(constraints.deadline)}`,
      cart: cart.delivery_eta ? `Estimated ${formatDay(cart.delivery_eta)}` : 'No estimate given',
      status,
      note: c?.detail,
      why: why('deadline', status),
    });
  }

  if (constraints.require_approval_over) {
    const c = findCheck(guard, 'approval_threshold', 'require_approval_over');
    const status: DiffStatus = c?.status ?? (Number(total) > Number(constraints.require_approval_over) ? 'escalate' : 'pass');
    rows.push({
      key: 'approval',
      label: ruleLabel('approval_threshold'),
      mandate: `Buyer approves anything above ${formatMoney(constraints.require_approval_over, constraints.max_total.currency)}`,
      cart: formatMoney(total, cart.currency),
      status,
      note: c?.detail,
      why: why('approval', status),
    });
  }

  return rows;
}

/** One-line summary above the comparison, e.g. "2 of 5 checks failed". */
export function summarise(rows: DiffRow[]): { text: string; tone: 'good' | 'bad' | 'warn' } {
  const failed = rows.filter((r) => r.status === 'fail').length;
  const open = rows.filter((r) => r.status === 'unsure' || r.status === 'escalate').length;
  if (failed) return { text: `${failed} of ${rows.length} checks failed: the cart broke the buyer’s mandate.`, tone: 'bad' };
  if (open) {
    return {
      text: `Nothing broke the mandate, but ${open} check${open === 1 ? '' : 's'} could not be confirmed or needed the buyer’s approval.`,
      tone: 'warn',
    };
  }
  return { text: `All ${rows.length} checks passed: the cart matched the mandate.`, tone: 'good' };
}
