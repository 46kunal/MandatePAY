/** Money helpers on integer minor units, so the guard never does floating-point arithmetic (owner: B). */
import type { Cart } from '../../contracts/schemas';

/** "110.00" -> 11000. Input must already satisfy the Amount schema. */
export function toMinor(amount: string): number {
  const [whole, frac] = amount.split('.');
  return Number(whole) * 100 + Number(frac);
}

/** 11000 -> "110.00" */
export function fromMinor(minor: number): string {
  const whole = Math.floor(minor / 100);
  return `${whole}.${String(minor % 100).padStart(2, '0')}`;
}

/** Sum of unit_price * quantity over all items, in minor units. */
export function cartTotalMinor(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + toMinor(item.unit_price) * item.quantity, 0);
}
