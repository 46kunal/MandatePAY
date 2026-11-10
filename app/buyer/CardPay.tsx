'use client';
// OWNER: A. Pay by card with PayPal's hosted card fields. The number, expiry and CVV boxes are drawn by PayPal inside
// our page, so card data never reaches our server. 3-D Secure is handled by PayPal when the card's bank asks for it.
// Must render inside <PayPalScriptProvider options={{ components: 'buttons,card-fields' }}>.
import { useState } from 'react';
import { PayPalCardFieldsForm, PayPalCardFieldsProvider, usePayPalCardFields } from '@paypal/react-paypal-js';
import u from '../_ui/ui.module.css';

const FIELD_STYLE = {
  input: { 'font-size': '16px', 'font-family': 'system-ui, sans-serif', color: '#111827', padding: '10px' },
  ':focus': { color: '#111827' },
  '.invalid': { color: '#b91c1c' },
};

function SubmitCard({ label, busy, onBusy, onError }: { label: string; busy: boolean; onBusy: (b: boolean) => void; onError: (m: string) => void }) {
  const { cardFieldsForm } = usePayPalCardFields();
  async function pay() {
    if (!cardFieldsForm) return;
    onError('');
    const state = await cardFieldsForm.getState();
    if (!state.isFormValid) {
      onError('Check the card details: one of the fields is empty or not valid.');
      return;
    }
    onBusy(true);
    try {
      // On success PayPal calls onApprove below; on a declined or failed card it throws and calls onError.
      await cardFieldsForm.submit();
    } catch {
      /* reported through the provider's onError */
    } finally {
      onBusy(false);
    }
  }
  return (
    <button className={u.btn} type="button" onClick={pay} disabled={busy || !cardFieldsForm} style={{ marginTop: '0.75rem', width: '100%' }}>
      {busy ? 'Paying…' : label}
    </button>
  );
}

export default function CardPay({
  total,
  createOrder,
  onApproved,
  onError,
  error,
}: {
  total: string; // already formatted, e.g. "$89.00"
  createOrder: () => Promise<string>;
  onApproved: (orderId: string) => Promise<void>;
  onError: (message: string) => void;
  error: string | null;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ marginTop: '1rem' }}>
      <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Or pay by card</p>
      <PayPalCardFieldsProvider
        createOrder={createOrder}
        onApprove={async (data) => {
          try {
            await onApproved(data.orderID);
          } finally {
            setBusy(false);
          }
        }}
        onError={() => {
          setBusy(false);
          onError('The card was not accepted. Check the details, try another card, or pay with PayPal.');
        }}
        style={FIELD_STYLE}
      >
        <PayPalCardFieldsForm />
        <SubmitCard label={`Pay ${total} by card`} busy={busy} onBusy={setBusy} onError={onError} />
      </PayPalCardFieldsProvider>
      {error && <span className={u.srOnly} role="status">{error}</span>}
      <p className={u.muted} style={{ margin: '0.5rem 0 0', fontSize: '0.85em' }}>
        Card details go straight to PayPal and never reach this store. In the sandbox, use PayPal&rsquo;s test cards, for example
        4111 1111 1111 1111 with any future date and any 3 digit code.
      </p>
    </div>
  );
}
