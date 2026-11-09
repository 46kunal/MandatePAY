import type { PollDisputesResponse } from '@/contracts/schemas';
import { db, schema } from '@/db/client';
import type { z } from 'zod';
import { requireSimulation } from '../_demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OWNER: C. Demo twin of POST /api/disputes/poll (A). There is no PayPal to ask, so it reports the cases already
// in the database (the seeded demo disputes) and finds nothing new.
export async function POST() {
  const blocked = requireSimulation();
  if (blocked) return blocked;

  const rows = await db.select({ orderId: schema.cases.paypalOrderId }).from(schema.cases);
  const response: z.infer<typeof PollDisputesResponse> = {
    fetched: rows.length,
    new_cases: 0,
    linked: rows.filter((r) => r.orderId).length,
  };
  return Response.json(response);
}
