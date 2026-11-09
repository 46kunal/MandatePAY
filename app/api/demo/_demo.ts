// OWNER: C. Demo mode helpers: the app runs with no PayPal credentials and no LLM key.
// The demo routes reuse A's real order / case logic and database code, with only the PayPal calls stubbed.
import { randomBytes } from 'node:crypto';
import { apiError } from '@/lib/http';
import {
  checkCart,
  computeReceiptHash,
  createClosedMandate,
  hashCart,
  verifyClosedMandate,
} from '@/lib/mandate';
import type { ActDeps } from '@/lib/paypal/caseActions';
import { drizzleActStore, drizzleStore } from '@/lib/paypal/deps';
import type { OrderDeps } from '@/lib/paypal/service';

/** Demo mode is opt-in: set DEMO_MODE=true. Anything else (including unset) keeps the real behaviour. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE?.trim().toLowerCase() === 'true';
}

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID?.trim() && process.env.PAYPAL_CLIENT_SECRET?.trim());
}

/** The LLM provider the app will use. Empty means mock (see lib/ai/client.ts). */
export function llmProvider(): string {
  return process.env.LLM_PROVIDER?.trim().toLowerCase() || 'mock';
}

/** Simulation routes only run in demo mode, and never when real PayPal credentials exist. */
export function requireSimulation(): Response | null {
  if (!isDemoMode()) return apiError(403, 'demo_mode_only', 'This route is only available when DEMO_MODE=true.');
  if (paypalConfigured()) {
    return apiError(403, 'paypal_configured', 'PayPal sandbox credentials are set, so use the real routes.');
  }
  return null;
}

const hex = () => randomBytes(6).toString('hex').toUpperCase();

/** Order service wired to the real database and mandate code, with PayPal replaced by a local stand-in. */
export function demoOrderDeps(): OrderDeps {
  return {
    store: drizzleStore(),
    checkCart: (jws, cart) => checkCart(jws, cart),
    hashCart,
    createClosedMandate,
    verifyClosedMandate,
    computeReceiptHash,
    createOrder: async () => {
      const id = `DEMO-ORD-${hex()}`;
      return { paypalOrderId: id, status: 'CREATED', approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` };
    },
    captureOrder: async (paypalOrderId) => ({
      paypalOrderId,
      captureId: `DEMO-CAP-${hex()}`,
      status: 'COMPLETED',
      captureStatus: 'COMPLETED',
    }),
  };
}

/** Case actions wired to the real database; the PayPal Disputes calls do nothing. */
export function demoActDeps(): ActDeps {
  const noop = async () => undefined;
  return {
    store: drizzleActStore(),
    actions: { provideEvidence: noop, makeOffer: noop, acceptClaim: noop, sendMessage: noop },
  };
}
