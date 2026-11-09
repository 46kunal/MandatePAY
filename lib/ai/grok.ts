/**
 * xAI Grok provider. xAI's API follows the OpenAI chat-completions format. Plain fetch, no SDK.
 *
 * Structured output: response_format { type: "json_object" }, with the Zod-derived JSON Schema also written into the
 * system prompt. generateJson() validates the answer with Zod and retries once with the errors fed back.
 *
 * The API key is sent only in the Authorization header and never appears in error messages.
 * Select with LLM_PROVIDER=grok. Set LLM_MODEL to a model your key can use (list them with scripts/llm-models.ts).
 */
import { LlmError, type LlmProvider, type ProviderCall } from './types';

const API_URL = 'https://api.x.ai/v1/chat/completions';
/** Override with LLM_MODEL; model names change, so confirm the one your key can use. */
export const DEFAULT_GROK_MODEL = 'grok-4';

export interface GrokOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
}

export class GrokProvider implements LlmProvider {
  readonly name = 'grok';
  readonly deterministic = false;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;

  constructor(opts: GrokOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_GROK_MODEL;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxTokens = opts.maxTokens ?? 4096;
  }

  async complete(call: ProviderCall): Promise<unknown> {
    const { $schema: _ignored, ...schema } = call.jsonSchema();
    const system = `${call.system}\n\nReturn ONLY a JSON object that matches this JSON Schema, with no prose and no code fences:\n${JSON.stringify(schema)}`;

    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: call.user },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: this.maxTokens,
          stream: false,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new LlmError('provider_error', timedOut ? 'LLM request timed out' : 'LLM request failed (network error)');
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new LlmError('provider_error', `LLM returned a non-JSON response (HTTP ${res.status})`, res.status);
    }

    if (!res.ok) {
      const err = (body as { error?: { message?: string } | string })?.error;
      const apiMessage = typeof err === 'string' ? err : err?.message;
      throw new LlmError(
        'provider_error',
        `LLM API error (HTTP ${res.status})${apiMessage ? `: ${apiMessage.slice(0, 300)}` : ''}`,
        res.status,
      );
    }

    const choice = (body as { choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }> }).choices?.[0];
    if (choice?.finish_reason === 'length') throw new LlmError('provider_error', 'LLM answer was cut off (max tokens reached)');
    const text = choice?.message?.content;
    if (!text) throw new LlmError('provider_error', 'LLM returned no content');
    // Some answers arrive wrapped in a code fence despite the instruction; generateJson parses and validates the rest.
    return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
}
