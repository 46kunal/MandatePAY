'use client';
// OWNER: C. PayPal checkout for the buyer page.
//  - create: POST /api/orders   (guard runs on the server; 422 guard_blocked, or needs_approval)
//  - capture: POST /api/orders/:id/capture after the buyer approves in the PayPal popup
// It renders the real PayPal sandbox buttons, which need NEXT_PUBLIC_PAYPAL_CLIENT_ID. Without it, it says what to set.
import { useState } from 'react';
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js';
import type { Cart, CaptureOrderResponse, GuardResult, PlaceOrderResponse } from '@/contracts/schemas';
import type { z } from 'zod';
import { ApiClientError, apiFetch } from '@/app/_ui/api';
import { formatMoney } from '../_ui/labels';
import { Notice } from '../_ui/Ui';
import u from '../_ui/ui.module.css';
import s from './buyer.module.css';

type Placed = z.infer<typeof PlaceOrderResponse>;
type Captured = z.infer<typeof CaptureOrderResponse>;

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID?.trim() || '';

class NeedsApprovalError extends Error {}

function errMsg(e: unknown): string {
  if (e instanceof NeedsApprovalError) return e.message;
  if (e instanceof ApiClientError) {
    if (e.body.error === 'guard_blocked') return 'The mandate check blocked this cart, so no PayPal order was created.';
    if (e.body.error === 'paypal_not_configured') return 'PayPal is not configured on the server.';
    return e.body.message ?? e.body.error ?? `Request failed (${e.status})`;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

export default function Checkout({
  mandateId,
  cart,
  guard,
  onPaid,
}: {
  mandateId: string;
  cart: Cart;
  guard: GuardResult;
  onPaid: () => void;
}) {
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState<Captured | null>(null);
  // Set when the server itself answers needs_approval (e.g. it disagrees with our earlier check).
  const [serverNeedsApproval, setServerNeedsApproval] = useState(false);

  const needsApproval = (guard.verdict === 'escalate' || serverNeedsApproval) && !approved;

  async function place(): Promise<Extract<Placed, { status: 'created' }>> {
    const r = await apiFetch<Placed>('/api/orders', {
      body: { mandate_id: mandateId, cart, buyer_approved: approved },
    });
    if (r.data.status === 'needs_approval') {
      setServerNeedsApproval(true);
      throw new NeedsApprovalError('This order needs your approval first.');
    }
    return r.data;
  }

  async function capture(orderId: string): Promise<Captured> {
    const r = await apiFetch<Captured>(`/api/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST' });
    return r.data;
  }

  if (guard.verdict === 'block') {
    return (
      <div className={s.checkout}>
        <Notice tone="bad">Checkout is unavailable: the cart breaks your mandate, so no PayPal order will be created.</Notice>
      </div>
    );
  }

  if (paid) {
    return (
      <div className={s.checkout}>
        <Notice tone="good">
          <strong>Payment {paid.status.toLowerCase()}.</strong>
          <div className={u.muted}>
            Order {paid.paypal_order_id} · capture {paid.capture_id}
          </div>
        </Notice>
      </div>
    );
  }

  if (needsApproval) {
    return (
      <div className={s.checkout}>
        <div className={s.approval} role="alert">
          <strong>Your approval is needed</strong>
          <p>
            This cart fits your mandate, but you asked to approve larger purchases yourself:{' '}
            {guard.checks
              .filter((c) => c.status === 'escalate' || c.status === 'unsure')
              .map((c) => c.detail)
              .join(' ') || 'the server asked for confirmation.'}{' '}
            Total {formatMoney(guard.total, guard.currency)}.
          </p>
          <button className={u.btn} onClick={() => setApproved(true)}>
            I approve this purchase
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.checkout}>
      {error && (
        <Notice tone="bad" alert>
          {error}
        </Notice>
      )}
      {CLIENT_ID ? (
        <PayPalScriptProvider
          // Re-mount if the currency changes; the SDK script is loaded per currency.
          key={cart.currency}
          options={{ clientId: CLIENT_ID, currency: cart.currency, intent: 'capture' }}
        >
          <PayPalButtons
            style={{ layout: 'vertical' }}
            disabled={busy}
            createOrder={async () => {
              setError(null);
              try {
                return (await place()).paypal_order_id;
              } catch (e) {
                setError(errMsg(e));
                throw e;
              }
            }}
            onApprove={async (data) => {
              try {
                setPaid(await capture(data.orderID));
                onPaid();
              } catch (e) {
                setError(errMsg(e));
              }
            }}
            onCancel={() => setError('Payment was cancelled. You have not been charged.')}
            onError={(e) => setError((prev) => prev ?? errMsg(e))}
          />
        </PayPalScriptProvider>
      ) : (
        <div className={s.error} role="alert">
          The PayPal button is not configured. Set NEXT_PUBLIC_PAYPAL_CLIENT_ID in .env (same value as PAYPAL_CLIENT_ID)
          and restart the server.
        </div>
      )}
    </div>
  );
}
