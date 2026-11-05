/** Webhook signature verification via PayPal's verify-webhook-signature endpoint (owner: A). */
import type { PayPalClient } from './client';
import { PayPalConfigError } from './errors';

/** Returns true only when PayPal says SUCCESS. Missing signature headers return false (route answers 400). */
export async function verifyWebhookSignature(client: PayPalClient, headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = client.config.webhookId;
  if (!webhookId) throw new PayPalConfigError('PAYPAL_WEBHOOK_ID is not set; cannot verify webhooks.');

  const fields = {
    auth_algo: headers.get('paypal-auth-algo'),
    cert_url: headers.get('paypal-cert-url'),
    transmission_id: headers.get('paypal-transmission-id'),
    transmission_sig: headers.get('paypal-transmission-sig'),
    transmission_time: headers.get('paypal-transmission-time'),
  };
  if (Object.values(fields).some((v) => !v)) return false;

  const res = await client.request<{ verification_status?: string }>('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: { ...fields, webhook_id: webhookId, webhook_event: event },
  });
  return res?.verification_status === 'SUCCESS';
}
