import { apiError } from '@/lib/http';
import { getCaseDetail } from '@/lib/paypal/cases';
import { buildEvidenceModel, renderEvidencePdf } from '@/lib/paypal/evidencePack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OWNER: A. GET -> application/pdf: the dispute's evidence pack (payment record, signed mandate, cart, guard checks, analysis).
// 404 unknown case. Add ?download=1 to force a file download instead of showing it in the browser.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const detail = await getCaseDetail(id);
  if (!detail) return apiError(404, 'case_not_found', `No case with id ${id}.`);

  const pdf = await renderEvidencePdf(buildEvidenceModel(detail));
  const disposition = new URL(req.url).searchParams.get('download') ? 'attachment' : 'inline';
  const safeName = id.replace(/[^A-Za-z0-9_-]/g, '_');
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="evidence-${safeName}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
