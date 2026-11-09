'use client';
// OWNER: C. PayPal checkout for the buyer page.
//  - create: POST /api/orders   (guard runs on the server; 422 guard_blocked, or needs_approval)
//  - capture: POST /api/orders/:id/capture after the buyer approves in the PayPal popup
// With NEXT_PUBLIC_PAYPAL_CLIENT_ID set it renders the real PayPal buttons (sandbox). Without it, it shows a
// "simulate" button that runs the same two API calls, so the demo works with no PayPal credentials.
import { useEffect, useState } from 'react';
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js';
import type { Cart, CaptureOrderResponse, GuardResult, PlaceOrderResponse } from '@/contracts/schemas';
import type { z } from 'zod';
import { ApiClientError, apiFetch } from '@/fixtures/api';
import { formatMoney } from '../_ui/labels';
import u from '../_ui/ui.module.css';
import s from './buyer.module.css';

type Placed = z.infer<typeof PlaceOrderResponse>;
type Captured = z.infer<typeof CaptureOrderResponse>;

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID?.trim() || '';

class NeedsApprovalError extends Error {}

function errMsg(e: unknown): string {
  if (e instanceof NeedsApprovalError) return e.message;
  if (e instanceof ApiClientError) {
    if (e.body.error === 'guard_blocked') return 'The mandate guard blocked this cart, so no PayPal order was created.';
    if (e.body.error === 'paypal_not_configured') return 'PayPal is not configured on the server.';
    return e.body.message ?? e.body.error ?? `Request failed (${e.status})`;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

export default function Checkout({
  mandateId,
  cart,
  guard,
  onFixture,
}: {
  mandateId: string;
  cart: Cart;
  guard: GuardResult;
  /** Called when a fixture answered instead of the server, so the page can show its demo banner. */
  onFixture: () => void;
}) {
  // Simulation is only honest when the server runs in demo mode. With real PayPal credentials and no public
  // client id there is no way to get the buyer's approval, so say what to configure instead of failing at capture.
  const [demoMode, setDemoMode] = useState<boolean | null>(null);
  useEffect(() => {
    if (CLIENT_ID) return;
    fetch('/api/demo/status')
      .then((r) => r.json())
      .then((d: { demo?: boolean }) => setDemoMode(Boolean(d.demo)))
      .catch(() => setDemoMode(false));
  }, []);
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
    if (r.fromFixture) onFixture();
    if (r.data.status === 'needs_approval') {
      setServerNeedsApproval(true);
      throw new NeedsApprovalError('This order needs your approval first.');
    }
    return r.data;
  }

  async function capture(orderId: string): Promise<Captured> {
    const r = await apiFetch<Captured>(`/api/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST' });
    if (r.fromFixture) onFixture();
    return r.data;
  }

  async function simulate() {
    setBusy(true);
    setError(null);
    try {
      const placed = await place();
      setPaid(await capture(placed.paypal_order_id));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (guard.verdict === 'block') {
    return (
      <div className={`${s.verdict} ${s.verdictBlock}`} role="status">
        Checkout is unavailable: the cart breaks your mandate, so no PayPal order will be created.
      </div>
    );
  }

  if (paid) {
    return (
      <div className={`${s.verdict} ${s.verdictAllow}`} role="status">
        Payment {paid.status.toLowerCase()}.
        <div className={s.muted}>
          Order {paid.paypal_order_id} · capture {paid.capture_id}
        </div>
      </div>
    );
  }

  if (needsApproval) {
    return (
      <div className={s.approval} role="alert">
        <strong>Needs your approval</strong>
        <p className={s.muted}>
          This cart is allowed by your mandate but needs your explicit OK:{' '}
          {guard.checks
            .filter((c) => c.status === 'escalate' || c.status === 'unsure')
            .map((c) => c.detail)
            .join(' ') || 'the server asked for confirmation.'}{' '}
          Total {formatMoney(guard.total, guard.currency)}.
        </p>
        <div className={s.row}>
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
        <div className={s.error} role="alert">
          {error}
        </div>
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
              } catch (e) {
                setError(errMsg(e));
              }
            }}
            onCancel={() => setError('Payment was cancelled. You have not been charged.')}
            onError={(e) => setError((prev) => prev ?? errMsg(e))}
          />
        </PayPalScriptProvider>
      ) : demoMode === false ? (
        <div className={s.error} role="alert">
          The PayPal button is not configured. Set NEXT_PUBLIC_PAYPAL_CLIENT_ID in .env (same value as PAYPAL_CLIENT_ID) and
          restart the server, or start the app with DEMO_MODE=true and no PayPal credentials to simulate payment.
        </div>
      ) : demoMode === null ? (
        <p className={s.muted}>Loading payment options…</p>
      ) : (
        <>
          <p className={s.muted}>
            PayPal is simulated in demo mode, so no real money moves.
          </p>
          <div className={s.row}>
            <button className={u.btn} onClick={simulate} disabled={busy}>
              {busy ? 'Paying…' : `Pay ${formatMoney(guard.total, guard.currency)} with PayPal`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
