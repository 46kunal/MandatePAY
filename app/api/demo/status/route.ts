import { isDemoMode, llmProvider, paypalConfigured } from '../_demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OWNER: C. GET -> { demo, paypal_configured, llm_provider }. Lets the UI show a demo banner and the Reset button.
export async function GET() {
  return Response.json({
    demo: isDemoMode(),
    paypal_configured: paypalConfigured(),
    llm_provider: llmProvider(),
  });
}
