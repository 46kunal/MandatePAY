import { notImplemented } from '@/lib/http';

export const runtime = 'nodejs';

// OWNER: C. POST. Reset the database to the seeded demo state (see scripts/seed.ts). Disable outside demo mode.
export async function POST() {
  return notImplemented('C', 'Reset and seed demo data');
}
