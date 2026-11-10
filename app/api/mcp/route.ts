import { audit } from '@/lib/audit';
import { apiError } from '@/lib/http';
import { requireApiKey } from '@/lib/mcp/auth';
import { handleRpc } from '@/lib/mcp/protocol';
import { makeTools } from '@/lib/mcp/tools';
import { realToolDeps } from '@/lib/mcp/wiring';
import { limited } from '@/lib/rateLimit';

export const runtime = 'nodejs';
// check_cart can call the AI for the matches the rules cannot settle.
export const maxDuration = 150;
export const dynamic = 'force-dynamic';

// OWNER: orchestrator. The Model Context Protocol endpoint (Streamable HTTP, JSON replies) for outside AI agents.
// Auth: "Authorization: Bearer <agent key>", made by the buyer on their account page. 401 without a valid key.
// The tools work only inside mandates the buyer already signed, and place_order hands back a PayPal approval link
// the buyer must open: an agent cannot sign a mandate or pay. See docs/MCP.md.
export async function POST(req: Request) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.response;
  const slow = limited(auth.user.id, 'mcp', 60);
  if (slow) return slow;

  const body = await req.json().catch(() => undefined);
  if (body === undefined) {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }
  const ctx = {
    user: auth.user,
    tools: makeTools(realToolDeps()),
    // Which tool, never what it was given: the audit log must not carry the buyer's data.
    onCall: (tool: string) => audit(auth.user, { action: 'mcp.call', targetType: 'tool', targetId: tool, details: { key_id: auth.user.keyId } }),
  };

  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 10) return apiError(400, 'invalid_request', 'Send one to ten messages.');
    const answers = (await Promise.all(body.map((m) => handleRpc(m, ctx)))).filter((a) => a !== null);
    return answers.length ? Response.json(answers) : new Response(null, { status: 202 });
  }
  const answer = await handleRpc(body, ctx);
  return answer ? Response.json(answer) : new Response(null, { status: 202 });
}

// Streaming sessions are not offered: the client should POST.
export async function GET() {
  return new Response(JSON.stringify({ error: 'method_not_allowed', message: 'POST JSON-RPC messages to this endpoint.' }), {
    status: 405,
    headers: { allow: 'POST', 'content-type': 'application/json' },
  });
}
