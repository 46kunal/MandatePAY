/**
 * Deterministic cart guard (owner: B).
 *
 * Every rule returns pass, fail, unsure or escalate with a reason. No LLM is involved here: an LLM may
 * later be asked about "unsure" rules (fuzzy matching) but it can never turn a "fail" into a pass.
 *
 * Verdict: any fail -> block; otherwise any unsure/escalate -> escalate (buyer must click); otherwise allow.
 */
import type { Cart, Constraints, GuardCheck, GuardResult } from '../../contracts/schemas';
import { cartTotalMinor, fromMinor, toMinor } from './money';

export interface GuardOptions {
  /** Used when the mandate has no require_approval_over of its own. Omit to skip the approval rule. */
  approvalThreshold?: string;
}

const lower = (s: string) => s.trim().toLowerCase();

function findAttribute(attributes: Record<string, string> | undefined, key: string): string | undefined {
  if (!attributes) return undefined;
  const hit = Object.keys(attributes).find((k) => lower(k) === lower(key));
  return hit === undefined ? undefined : attributes[hit];
}

function checkMaxTotal(c: Constraints, cart: Cart, totalMinor: number): GuardCheck {
  const rule = 'max_total';
  if (cart.currency !== c.max_total.currency) {
    return { rule, status: 'fail', detail: `Cart currency ${cart.currency} differs from the mandate currency ${c.max_total.currency}.` };
  }
  const max = toMinor(c.max_total.value);
  return totalMinor <= max
    ? { rule, status: 'pass', detail: `Total ${fromMinor(totalMinor)} is within the limit of ${c.max_total.value} ${c.max_total.currency}.` }
    : { rule, status: 'fail', detail: `Total ${fromMinor(totalMinor)} exceeds the limit of ${c.max_total.value} ${c.max_total.currency}.` };
}

function checkCategories(allowed: string[], cart: Cart): GuardCheck {
  const rule = 'categories';
  const allowedSet = new Set(allowed.map(lower));
  const wrong: string[] = [];
  const unknown: string[] = [];
  for (const item of cart.items) {
    if (!item.category) unknown.push(item.name);
    else if (!allowedSet.has(lower(item.category))) wrong.push(`${item.name} (${item.category})`);
  }
  if (wrong.length) return { rule, status: 'fail', detail: `Not in an allowed category [${allowed.join(', ')}]: ${wrong.join('; ')}.` };
  if (unknown.length) return { rule, status: 'unsure', detail: `No category on the listing for: ${unknown.join('; ')}.` };
  return { rule, status: 'pass', detail: `All items are in an allowed category [${allowed.join(', ')}].` };
}

function checkQuantity(max: number, cart: Cart): GuardCheck {
  const rule = 'max_quantity';
  const qty = cart.items.reduce((n, i) => n + i.quantity, 0);
  return qty <= max
    ? { rule, status: 'pass', detail: `Quantity ${qty} is within the limit of ${max}.` }
    : { rule, status: 'fail', detail: `Quantity ${qty} exceeds the limit of ${max}.` };
}

function checkAttributes(required: Record<string, string>, cart: Cart): GuardCheck {
  const rule = 'required_attributes';
  const mismatched: string[] = [];
  const missing: string[] = [];
  for (const item of cart.items) {
    for (const [key, want] of Object.entries(required)) {
      const got = findAttribute(item.attributes, key);
      if (got === undefined) missing.push(`${item.name} has no ${key}`);
      else if (lower(got) !== lower(want)) mismatched.push(`${item.name}: ${key} is "${got}", wanted "${want}"`);
    }
  }
  if (mismatched.length) return { rule, status: 'fail', detail: mismatched.join('; ') + '.' };
  if (missing.length) return { rule, status: 'unsure', detail: `Cannot confirm required attributes: ${missing.join('; ')}.` };
  return { rule, status: 'pass', detail: 'Every item has the required attributes.' };
}

function checkDeadline(deadline: string, cart: Cart): GuardCheck {
  const rule = 'deadline';
  if (!cart.delivery_eta) return { rule, status: 'unsure', detail: `No delivery estimate to compare with the deadline ${deadline}.` };
  return Date.parse(cart.delivery_eta) <= Date.parse(deadline)
    ? { rule, status: 'pass', detail: `Delivery ${cart.delivery_eta} is on or before the deadline ${deadline}.` }
    : { rule, status: 'fail', detail: `Delivery ${cart.delivery_eta} is after the deadline ${deadline}.` };
}

function checkApproval(threshold: string, totalMinor: number): GuardCheck {
  const rule = 'approval_threshold';
  return totalMinor > toMinor(threshold)
    ? { rule, status: 'escalate', detail: `Total ${fromMinor(totalMinor)} is over ${threshold}: the buyer must approve.` }
    : { rule, status: 'pass', detail: `Total ${fromMinor(totalMinor)} is within the auto-approve limit of ${threshold}.` };
}

/** Run every applicable rule against the cart. `constraints` must come from a verified mandate. */
export function evaluateCart(constraints: Constraints, cart: Cart, opts: GuardOptions = {}): GuardResult {
  const total = cartTotalMinor(cart);
  const checks: GuardCheck[] = [checkMaxTotal(constraints, cart, total)];

  if (constraints.categories?.length) checks.push(checkCategories(constraints.categories, cart));
  if (constraints.max_quantity !== undefined) checks.push(checkQuantity(constraints.max_quantity, cart));
  if (constraints.required_attributes && Object.keys(constraints.required_attributes).length) {
    checks.push(checkAttributes(constraints.required_attributes, cart));
  }
  if (constraints.deadline) checks.push(checkDeadline(constraints.deadline, cart));

  const threshold = constraints.require_approval_over ?? opts.approvalThreshold;
  if (threshold) checks.push(checkApproval(threshold, total));

  return { verdict: verdictOf(checks), checks, total: fromMinor(total), currency: cart.currency };
}

export function verdictOf(checks: GuardCheck[]): GuardResult['verdict'] {
  if (checks.some((c) => c.status === 'fail')) return 'block';
  if (checks.some((c) => c.status === 'unsure' || c.status === 'escalate')) return 'escalate';
  return 'allow';
}
