import { desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { Verdict } from '@/contracts/schemas';
import { requirePermission } from '@/lib/auth/guard';
import { csvResponse, toCsv } from '@/lib/csv';
import { fromMinor } from '@/lib/paypal/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> text/csv of every dispute case with the AI verdict and what was done. Store team.
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'cases:read');
  if (!authz.ok) return authz.response;
  const rows = await db.select().from(schema.cases).orderBy(desc(schema.cases.createdAt)).limit(5000);
  const csv = toCsv(
    [
      'dispute_id',
      'reason',
      'stage',
      'status',
      'amount',
      'currency',
      'order_id',
      'capture_id',
      'mandate_id',
      'ai_fault',
      'ai_action',
      'ai_confidence',
      'needs_human',
      'action_taken',
      'outcome',
      'opened_at',
      'updated_at',
    ],
    rows.map((c) => {
      const v = c.verdict as Verdict | null;
      return [
        c.disputeId,
        c.reason,
        c.stage,
        c.status,
        c.amountMinor === null ? '' : fromMinor(c.amountMinor),
        c.currency,
        c.paypalOrderId,
        c.captureId,
        c.mandateId,
        v?.fault,
        v?.action,
        v?.confidence,
        v?.needs_human,
        c.actionTaken,
        c.outcome,
        c.createdAt,
        c.updatedAt,
      ];
    }),
  );
  return csvResponse(`mandatepay-disputes-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
