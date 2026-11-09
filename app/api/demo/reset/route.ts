import { apiError } from '@/lib/http';
import { seedDemo } from '@/scripts/seed-lib';
import { isDemoMode } from '../_demo';

export const runtime = 'nodejs';

// OWNER: C. POST. Reset the database to the seeded demo state (see scripts/seed.ts). 403 outside demo mode.
export async function POST() {
  if (!isDemoMode()) {
    return apiError(403, 'demo_mode_only', 'Resetting data is only allowed when DEMO_MODE=true.');
  }
  try {
    const summary = await seedDemo();
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    console.error('demo reset failed', err);
    return apiError(500, 'reset_failed', 'Could not reset demo data. Is the database running and migrated?');
  }
}
