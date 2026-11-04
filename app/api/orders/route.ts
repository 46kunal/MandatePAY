import { notImplemented } from '@/lib/http';

export const runtime = 'nodejs';

// OWNER: A. POST { mandate_id, cart, buyer_approved } -> PlaceOrderResponse.
// Run the guard (B), then create the PayPal order with custom_id = mandate_id and invoice_id = cart_id.
// Blocked carts return HTTP 422 { error: 'guard_blocked', details: GuardResult }.
export async function POST() {
  return notImplemented('A', 'Create PayPal order bound to the mandate');
}
