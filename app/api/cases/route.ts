import { listCaseRecords } from '@/lib/paypal/cases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OWNER: A. GET -> CaseRecord[] (newest first). Read by the merchant UI (C).
export async function GET() {
  return Response.json(await listCaseRecords());
}
