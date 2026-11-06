// OWNER: C. Seeds demo mandates, carts, orders and disputes so the UI and analyst can be shown
// without PayPal sandbox credentials. Run with: npm run db:seed
// WARNING: this replaces ALL rows in the app tables with the demo scenarios.
import 'dotenv/config';

async function main() {
  const { seedDemo } = await import('./seed-lib');
  const { db } = await import('../db/client');
  try {
    const s = await seedDemo();
    console.log(`seed: ok (${s.mandates} mandates, ${s.carts} carts, ${s.orders} orders, ${s.cases} cases)`);
  } finally {
    // Close the pool so the process can exit.
    await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
  }
}

main().catch((err) => {
  console.error('seed: failed', err);
  process.exit(1);
});
