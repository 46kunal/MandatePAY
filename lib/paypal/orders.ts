/** PayPal Orders v2 (owner: A). Binding: custom_id = mandate id, invoice_id = cart id. */
import type { Cart } from '../../contracts/schemas';
import type { PayPalClient } from './client';
import { PayPalError } from './errors';

export interface CreateOrderInput {
  mandateId: string;
  cartId: string;
  cart: Cart;
  /** Defaults to `${appBaseUrl}/buyer?paypal=return`. */
  returnUrl?: string;
  cancelUrl?: string;
  /** How the buyer pays: a PayPal account (the default) or a card typed into PayPal's hosted card fields. */
  funding?: 'paypal' | 'card';
}

export interface CreatedOrder {
  paypalOrderId: string;
  status: string;
  /** Where a PayPal-account buyer approves. Card orders have none: the card fields approve them in the page. */
  approveUrl?: string;
}

export interface CapturedOrder {
  paypalOrderId: string;
  captureId: string;
  /** Order status, e.g. COMPLETED. */
  status: string;
  /** Capture status, e.g. COMPLETED or PENDING. */
  captureStatus: string;
  /** The PayPal payer who paid, when PayPal says (guest card payers get one too). */
  payerId?: string | null;
  /** 'paypal' for a PayPal account, 'card' for guest card checkout, or another PayPal payment source name. */
  paymentSource?: string | null;
}

/** Pure: the payer id and payment source from an order or capture response. */
export function payerFromOrder(data: unknown): { payerId: string | null; paymentSource: string | null } {
  const o = (data && typeof data === 'object' ? data : {}) as { payer?: { payer_id?: unknown }; payment_source?: Record<string, unknown> };
  const payerId = typeof o.payer?.payer_id === 'string' && o.payer.payer_id ? o.payer.payer_id : null;
  const paymentSource = o.payment_source && typeof o.payment_source === 'object' ? (Object.keys(o.payment_source)[0] ?? null) : null;
  return { payerId, paymentSource };
}

/** "12.34" -> 1234. Amounts are strings with exactly two decimals (see contracts). */
export function toMinor(amount: string): number {
  const [whole, frac] = amount.split('.');
  return Number(whole) * 100 + Number(frac ?? '0');
}

export function fromMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Sum of quantity * unit_price in integer minor units (no floating point). */
export function cartTotalMinor(cart: Cart): number {
  return cart.items.reduce((sum, i) => sum + i.quantity * toMinor(i.unit_price), 0);
}

/** Card orders ask for 3-D Secure whenever the card's bank requires it. Card data never touches our server. */
const CARD_SOURCE = { card: { attributes: { verification: { method: 'SCA_WHEN_REQUIRED' } } } };

export function buildOrderPayload(input: CreateOrderInput, appBaseUrl: string) {
  const { cart } = input;
  const total = fromMinor(cartTotalMinor(cart));
  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        custom_id: input.mandateId,
        invoice_id: input.cartId,
        amount: {
          currency_code: cart.currency,
          value: total,
          breakdown: { item_total: { currency_code: cart.currency, value: total } },
        },
        items: cart.items.map((i) => ({
          name: i.name.slice(0, 127),
          sku: i.sku.slice(0, 127),
          quantity: String(i.quantity),
          unit_amount: { currency_code: cart.currency, value: i.unit_price },
          category: 'PHYSICAL_GOODS',
        })),
      },
    ],
    payment_source: input.funding === 'card' ? CARD_SOURCE : {
      paypal: {
        experience_context: {
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: input.returnUrl ?? `${appBaseUrl}/buyer?paypal=return`,
          cancel_url: input.cancelUrl ?? `${appBaseUrl}/buyer?paypal=cancel`,
        },
      },
    },
  };
}

/** Create an order. The request id is the cart id, so retrying the same cart returns the same PayPal order. */
export async function createOrder(client: PayPalClient, input: CreateOrderInput): Promise<CreatedOrder> {
  const data = await client.request<{ id?: string; status?: string; links?: { rel: string; href: string }[] }>(
    '/v2/checkout/orders',
    {
      method: 'POST',
      body: buildOrderPayload(input, client.config.appBaseUrl),
      requestId: input.funding === 'card' ? `order-${input.cartId}-card` : `order-${input.cartId}`,
    },
  );
  const approveUrl = data?.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
  if (!data?.id || (!approveUrl && input.funding !== 'card')) {
    throw new PayPalError('PayPal order response had no id or approval link', { status: 502, details: data });
  }
  return { paypalOrderId: data.id, status: data.status ?? 'CREATED', approveUrl };
}

/** Capture an approved order. The request id is stable per order, so a double click cannot capture twice. */
export async function captureOrder(client: PayPalClient, paypalOrderId: string): Promise<CapturedOrder> {
  const data = await client.request<{
    id?: string;
    status?: string;
    purchase_units?: { payments?: { captures?: { id: string; status?: string }[] } }[];
    payer?: { payer_id?: string };
    payment_source?: Record<string, unknown>;
  }>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    body: {},
    requestId: `capture-${paypalOrderId}`,
  });
  const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture?.id) {
    throw new PayPalError('PayPal capture response had no capture id', { status: 502, details: data });
  }
  let payer = payerFromOrder(data);
  if (!payer.payerId) {
    // A minimal capture response can leave out the payer; the order itself always has it. Best effort only.
    payer = await getOrder(client, paypalOrderId).then(payerFromOrder, () => payer);
  }
  return {
    paypalOrderId: data.id ?? paypalOrderId,
    captureId: capture.id,
    status: data.status ?? 'UNKNOWN',
    captureStatus: capture.status ?? 'UNKNOWN',
    payerId: payer.payerId,
    paymentSource: payer.paymentSource,
  };
}

export async function getOrder(client: PayPalClient, paypalOrderId: string) {
  return client.request<{ id: string; status: string; purchase_units?: { custom_id?: string; invoice_id?: string }[] }>(
    `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`,
  );
}
