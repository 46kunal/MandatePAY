import { notImplemented } from '@/lib/http';

export const runtime = 'nodejs';

// OWNER: A. GET -> CaseRecord[] (newest first). Read by the merchant UI (C).
export async function GET() {
  return notImplemented('A', 'List cases');
}
