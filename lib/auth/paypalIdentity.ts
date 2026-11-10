/**
 * PayPal identity for "Log in with PayPal" and "Connect PayPal" (owner: orchestrator).
 *
 * When a PayPal account is linked (sign-up or connect), Better Auth stores the OAuth tokens on the account row. A
 * database hook then asks PayPal's userinfo endpoint for the payer id and whether the account is verified, and saves
 * them on the user, so later payments can be matched to the signed-in buyer. Unlinking clears them.
 */

export interface PayPalIdentity {
  payerId: string | null;
  verified: boolean | null;
}

/** Pure: pull the fields we keep from PayPal's userinfo answer (schema=paypalv1.1). */
export function parsePayPalIdentity(info: unknown): PayPalIdentity {
  const o = (info && typeof info === 'object' ? info : {}) as Record<string, unknown>;
  const payerId = typeof o.payer_id === 'string' && o.payer_id.trim() ? o.payer_id.trim() : null;
  const verified = typeof o.verified_account === 'boolean' ? o.verified_account : o.verified_account === 'true' ? true : o.verified_account === 'false' ? false : null;
  return { payerId, verified };
}

/** Scopes asked of PayPal: sign-in (openid), email and name, and the PayPal account attributes (payer id, verified). */
export const PAYPAL_SCOPES = ['openid', 'email', 'profile', 'https://uri.paypal.com/services/paypalattributes'];

/** Sandbox-only, like the rest of the app: the web sign-in host that matches PAYPAL_BASE_URL. */
export function paypalAuthorizeUrl(): string {
  const url = new URL('https://www.sandbox.paypal.com/signin/authorize');
  url.searchParams.set('scope', PAYPAL_SCOPES.join(' '));
  return url.toString();
}

async function fetchIdentity(accessToken: string): Promise<PayPalIdentity> {
  const { getConfig } = await import('../config');
  const base = getConfig().PAYPAL_BASE_URL.replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`PayPal userinfo answered ${res.status}`);
  return parsePayPalIdentity(await res.json());
}

/** After a PayPal account row is created or refreshed: save the payer id and verified flag on the user. */
export async function savePayPalIdentity(account: { userId: string; providerId: string; accessToken?: string | null }): Promise<void> {
  if (account.providerId !== 'paypal' || !account.accessToken) return;
  try {
    const identity = await fetchIdentity(account.accessToken);
    const [{ eq }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
    await db
      .update(schema.users)
      .set({ paypalPayerId: identity.payerId, paypalVerified: identity.verified, paypalLinkedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, account.userId));
  } catch (err) {
    // Never block sign-in over this; the account page shows "connected, payer id not available" and can reconnect.
    console.error(`[paypal-identity] could not read the PayPal payer id: ${(err as Error).message}`);
  }
}

/** After the PayPal account is unlinked: forget the payer id. */
export async function clearPayPalIdentity(account: { userId: string; providerId: string }): Promise<void> {
  if (account.providerId !== 'paypal') return;
  const [{ eq }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  await db
    .update(schema.users)
    .set({ paypalPayerId: null, paypalVerified: null, paypalLinkedAt: null, updatedAt: new Date() })
    .where(eq(schema.users.id, account.userId));
}

/** How the PayPal account that paid relates to the buyer's linked PayPal account. */
export type PayerCheck = 'match' | 'different' | 'not_linked' | 'unknown';

export function payerCheck(orderPayerId: string | null | undefined, buyerPayerId: string | null | undefined): PayerCheck {
  if (!orderPayerId) return 'unknown';
  if (!buyerPayerId) return 'not_linked';
  return orderPayerId === buyerPayerId ? 'match' : 'different';
}
