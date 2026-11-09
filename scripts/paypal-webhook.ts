// Registers (or finds) the sandbox webhook that sends dispute events to this app, and prints its id for PAYPAL_WEBHOOK_ID.
// The public URL must be HTTPS and reach this app (for example a tunnel to localhost:3000).
//
//   npx tsx scripts/paypal-webhook.ts list
//   npx tsx scripts/paypal-webhook.ts register https://<public-host>
//   npx tsx scripts/paypal-webhook.ts delete <webhook-id>
//
// Prints webhook ids and URLs only (they are not secrets). Never prints credentials or tokens.
import 'dotenv/config';

const EVENTS = [
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'CUSTOMER.DISPUTE.RESOLVED',
];

interface Webhook {
  id: string;
  url: string;
  event_types: { name: string }[];
}

async function main() {
  const { getPayPalClient } = await import('../lib/paypal/client');
  const client = getPayPalClient();
  const [cmd, arg] = process.argv.slice(2);

  const list = async () =>
    (await client.request<{ webhooks?: Webhook[] }>('/v1/notifications/webhooks')).webhooks ?? [];

  if (cmd === 'list') {
    const hooks = await list();
    if (!hooks.length) console.log('No webhooks registered.');
    for (const h of hooks) console.log(`${h.id}  ${h.url}  [${h.event_types.map((e) => e.name).join(', ')}]`);
    return;
  }

  if (cmd === 'register') {
    if (!arg || !/^https:\/\//.test(arg)) throw new Error('Pass the public https base URL, e.g. https://abc.trycloudflare.com');
    const url = `${arg.replace(/\/+$/, '')}/api/webhooks/paypal`;
    const existing = (await list()).find((h) => h.url === url);
    if (existing) {
      console.log(`Already registered: ${existing.id}  ${url}`);
      console.log(`Set PAYPAL_WEBHOOK_ID=${existing.id} in .env and restart the app.`);
      return;
    }
    const created = await client.request<Webhook>('/v1/notifications/webhooks', {
      method: 'POST',
      body: { url, event_types: EVENTS.map((name) => ({ name })) },
    });
    console.log(`Registered: ${created.id}  ${url}`);
    console.log(`Set PAYPAL_WEBHOOK_ID=${created.id} in .env and restart the app.`);
    return;
  }

  if (cmd === 'delete') {
    if (!arg) throw new Error('Pass the webhook id to delete.');
    await client.request(`/v1/notifications/webhooks/${encodeURIComponent(arg)}`, { method: 'DELETE' });
    console.log(`Deleted ${arg}.`);
    return;
  }

  console.log('Usage: npx tsx scripts/paypal-webhook.ts list | register <https-base-url> | delete <webhook-id>');
}

main().catch((err: Error & { status?: number; paypalName?: string; debugId?: string }) => {
  const extra = [err.status && `status ${err.status}`, err.paypalName, err.debugId && `debug_id ${err.debugId}`].filter(Boolean);
  console.error(`${err.message}${extra.length ? ` [${extra.join(', ')}]` : ''}`);
  process.exitCode = 1;
});
