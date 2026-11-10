import { analyseStoredCase } from '@/lib/analyst/runCase';
import { requirePermission } from '@/lib/auth/guard';
import { apiError } from '@/lib/http';

export const runtime = 'nodejs';
// Calls the AI model: up to 60 s per attempt plus one fallback attempt.
export const maxDuration = 150;

// OWNER: B. POST -> Verdict, saved on the case. Input: DisputeSummary + mandate + cart + guard + payment facts
// (lib/analyst/runCase.ts, shared with the automatic run after webhooks and polls). The analyst may only choose
// actions listed in DisputeSummary.allowed_actions (enforced in lib/analyst).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'cases:analyse');
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const r = await analyseStoredCase(id);
  if (!r.ok) return apiError(r.status, r.error, r.message, r.details);
  return Response.json(r.verdict);
}
