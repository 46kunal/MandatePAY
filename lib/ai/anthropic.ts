/**
 * Anthropic Messages API provider (owner: B). Plain fetch, no SDK.
 *
 * Structured output uses forced tool use: the Zod schema becomes the tool's input_schema and the model
 * must call that tool, so the answer arrives as a JSON object. generateJson() still validates it.
 */
import { LlmError, type LlmProvider, type ProviderCall } from './types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
/** Override with LLM_MODEL. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly deterministic = false;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;

  constructor(opts: AnthropicOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxTokens = opts.maxTokens ?? 4096;
  }

  async complete(call: ProviderCall): Promise<unknown> {
    const { $schema: _ignored, ...inputSchema } = call.jsonSchema();

    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system: call.system,
          messages: [{ role: 'user', content: call.user }],
          tools: [
            {
              name: call.task,
              description: 'Return the final structured result for this task.',
              input_schema: inputSchema,
            },
          ],
          tool_choice: { type: 'tool', name: call.task },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new LlmError('provider_error', timedOut ? 'LLM request timed out' : 'LLM request failed (network error)');
    }

    // Never put the request headers (API key) in an error message.
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new LlmError('provider_error', `LLM returned a non-JSON response (HTTP ${res.status})`, res.status);
    }

    if (!res.ok) {
      const apiMessage = (body as { error?: { message?: string } })?.error?.message;
      throw new LlmError(
        'provider_error',
        `LLM API error (HTTP ${res.status})${apiMessage ? `: ${apiMessage.slice(0, 300)}` : ''}`,
        res.status,
      );
    }

    const { content, stop_reason: stopReason } = body as {
      content?: Array<{ type: string; input?: unknown }>;
      stop_reason?: string;
    };
    if (stopReason === 'max_tokens') {
      throw new LlmError('provider_error', 'LLM answer was cut off (max_tokens reached)');
    }
    const toolUse = content?.find((block) => block.type === 'tool_use');
    if (!toolUse) {
      throw new LlmError('provider_error', 'LLM did not return the requested tool call');
    }
    return toolUse.input;
  }
}
