// Verifies the PayPal sandbox credentials in .env. Prints only "token ok" or the error. Never prints the token.
// Run with: npx tsx scripts/paypal-token-check.ts
import 'dotenv/config';

async function main() {
  const { getPayPalClient } = await import('../lib/paypal/client');
  try {
    const token = await getPayPalClient().getAccessToken();
    console.log(token ? 'token ok' : 'token missing');
  } catch (err) {
    const e = err as Error & { status?: number; paypalName?: string; debugId?: string };
    console.error(`token failed: ${e.name}: ${e.message}${e.status !== undefined ? ` [status ${e.status}]` : ''}`);
    process.exitCode = 1;
  }
}

void main();
