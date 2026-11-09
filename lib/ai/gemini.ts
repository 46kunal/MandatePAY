/**
 * Google Gemini provider (generateContent REST API). Plain fetch, no SDK.
 *
 * Structured output: responseMimeType "application/json", with the Zod-derived JSON Schema also written into the
 * system prompt. We do not send it as responseSchema because Gemini accepts only a subset of JSON Schema and rejects
 * some Zod output ($ref, additionalProperties, ...). generateJson() validates the answer with Zod and retries once
 * with the validation errors fed back, so a loose answer is caught there.
 *
 * The API key travels in the x-goog-api-key header, never in the URL, so it cannot end up in logs or error messages.
 */
import { LlmError, type LlmProvider, type ProviderCall } from './types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Override with LLM_MODEL. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  readonly deterministic = false;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;

  constructor(opts: GeminiOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_GEMINI_MODEL;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxOutputTokens = opts.maxOutputTokens ?? 4096;
  }

  async complete(call: ProviderCall): Promise<unknown> {
    const { $schema: _ignored, ...schema } = call.jsonSchema();
    const system = `${call.system}\n\nReturn ONLY a JSON object that matches this JSON Schema, with no prose and no code fences:\n${JSON.stringify(schema)}`;

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: call.user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: this.maxOutputTokens,
            temperature: 0,
          },
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
      const apiMessage = (body as { error?: { message?: string } })?.error?.message;
      throw new LlmError(
        'provider_error',
        `LLM API error (HTTP ${res.status})${apiMessage ? `: ${apiMessage.slice(0, 300)}` : ''}`,
        res.status,
      );
    }

    const { candidates, promptFeedback } = body as {
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
      promptFeedback?: { blockReason?: string };
    };
    if (promptFeedback?.blockReason) {
      throw new LlmError('provider_error', `LLM blocked the request (${promptFeedback.blockReason})`);
    }
    const first = candidates?.[0];
    if (first?.finishReason === 'MAX_TOKENS') {
      throw new LlmError('provider_error', 'LLM answer was cut off (max output tokens reached)');
    }
    const text = first?.content?.parts?.map((p) => p.text ?? '').join('');
    if (!text) throw new LlmError('provider_error', 'LLM returned no content');
    // Some answers arrive wrapped in a code fence despite the instruction; generateJson parses and validates the rest.
    return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
}
