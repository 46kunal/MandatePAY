import { requirePermission } from '@/lib/auth/guard';
import { csvResponse, toCsv } from '@/lib/csv';
import { listOrders } from '@/lib/paypal/orderList';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> text/csv of every order (newest first, at most 5000). Store team.
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'orders:read:all');
  if (!authz.ok) return authz.response;
  const orders = await listOrders({ limit: 5000 });
  const csv = toCsv(
    ['order_id', 'status', 'total', 'currency', 'items', 'mandate_id', 'cart_id', 'capture_id', 'placed_at', 'captured_at', 'dispute_id', 'receipt_hash'],
    orders.map((o) => [
      o.paypal_order_id,
      o.status,
      o.total,
      o.currency,
      o.items.map((i) => `${i.quantity} x ${i.name}`).join('; '),
      o.mandate_id,
      o.cart_id,
      o.capture_id,
      o.created_at,
      o.captured_at,
      o.dispute_id,
      o.receipt_hash,
    ]),
  );
  return csvResponse(`mandatepay-orders-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
