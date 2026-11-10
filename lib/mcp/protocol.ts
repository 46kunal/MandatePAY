/**
 * The Model Context Protocol, the small part MandatePay needs (owner: orchestrator). JSON-RPC 2.0 over HTTP POST
 * ("Streamable HTTP", replying with plain JSON): initialize, ping, tools/list and tools/call. Pure and injectable, so
 * it is unit-tested without a database or a network.
 */

export const SERVER_INFO = { name: 'mandatepay', version: '1.0.0' };
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface McpTool<U> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Returns the data to show the agent. Throw ToolError for a refusal the agent should read. */
  run(args: unknown, user: U): Promise<unknown>;
}

/** A refusal with a message written for the agent (shown as a tool error, not a protocol error). */
export class ToolError extends Error {}

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export type RpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

const ok = (id: RpcRequest['id'], result: unknown): RpcResponse => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: RpcRequest['id'], code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export const INSTRUCTIONS =
  'MandatePay lets you shop for a buyer inside spending limits (a mandate) the buyer already signed. Call list_mandates, ' +
  'then list_products, check_cart to test a basket against the mandate, and place_order to create the PayPal order. ' +
  'You cannot sign mandates or pay: place_order returns an approval link the buyer must open and approve in PayPal. ' +
  'If a cart is blocked, say why and choose different items; never try to get around a limit.';

/** One message in, one answer out. null for notifications, which get no answer. */
export async function handleRpc<U>(
  msg: unknown,
  ctx: { user: U; tools: McpTool<U>[]; onCall?: (tool: string) => void | Promise<void> },
): Promise<RpcResponse | null> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return fail(null, -32600, 'Invalid request');
  const r = msg as RpcRequest;
  if (r.jsonrpc !== '2.0' || typeof r.method !== 'string') return fail(r.id, -32600, 'Invalid request');
  const isNotification = r.id === undefined;

  switch (r.method) {
    case 'initialize': {
      const asked = typeof r.params?.protocolVersion === 'string' ? r.params.protocolVersion : '';
      return ok(r.id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok(r.id, {});
    case 'tools/list':
      return ok(r.id, { tools: ctx.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = typeof r.params?.name === 'string' ? r.params.name : '';
      const tool = ctx.tools.find((t) => t.name === name);
      if (!tool) return fail(r.id, -32602, `Unknown tool: ${name || '(none)'}`);
      await ctx.onCall?.(tool.name);
      try {
        const data = await tool.run(r.params?.arguments ?? {}, ctx.user);
        return ok(r.id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (e) {
        // A refusal or a bad argument is the agent's to read and correct; it is not a protocol failure.
        const message = e instanceof ToolError ? e.message : 'The tool failed. Try again, or ask the buyer to check the app.';
        if (!(e instanceof ToolError)) console.error(`[mcp] ${tool.name}:`, e);
        return ok(r.id, { content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      if (r.method.startsWith('notifications/') || isNotification) return null;
      return fail(r.id, -32601, `Method not found: ${r.method}`);
  }
}
