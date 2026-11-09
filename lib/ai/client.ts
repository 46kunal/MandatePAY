/**
 * LLM entry point (owner: B): pick a provider from the environment, ask for JSON, validate with Zod.
 *
 * Environment (see .env.example):
 *   LLM_PROVIDER  "gemini" | "grok" | "anthropic". Required: there is no offline stand-in.
 *   LLM_API_KEY   the provider's key.
 *   LLM_MODEL     optional model override.
 *
 * Callers never see raw model text: generateJson() returns data that already passed the schema, or
 * throws LlmError (routes turn 'config' into HTTP 500 and everything else into 502).
 */
import { z } from 'zod';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { GrokProvider } from './grok';
import { LlmError, type LlmProvider, type LlmRequest } from './types';

type Env = Record<string, string | undefined>;

const clean = (value: string | undefined) => value?.trim() || undefined;

const PROVIDERS = '"gemini", "grok" or "anthropic"';

/** Build the provider named by the environment. Pass `env` in tests. */
export function resolveProvider(env: Env = process.env): LlmProvider {
  const name = clean(env.LLM_PROVIDER)?.toLowerCase();
  const apiKey = clean(env.LLM_API_KEY);
  if (!name) throw new LlmError('config', `LLM_PROVIDER is not set. Set it to ${PROVIDERS} and add LLM_API_KEY in .env.`);
  if (!apiKey && ['gemini', 'grok', 'anthropic'].includes(name)) {
    throw new LlmError('config', `LLM_PROVIDER=${name} needs LLM_API_KEY in .env.`);
  }

  switch (name) {
    case 'anthropic':
      return new AnthropicProvider({ apiKey: apiKey!, model: clean(env.LLM_MODEL) });
    case 'gemini':
      return new GeminiProvider({ apiKey: apiKey!, model: clean(env.LLM_MODEL), fallbackModel: env.LLM_FALLBACK_MODEL?.trim() });
    case 'grok':
      return new GrokProvider({ apiKey: apiKey!, model: clean(env.LLM_MODEL) });
    default:
      throw new LlmError('config', `Unknown LLM_PROVIDER "${name}". Use ${PROVIDERS}.`);
  }
}

export interface GenerateJsonOptions<T> extends LlmRequest {
  schema: z.ZodType<T>;
  /** Extra attempts after a malformed or schema-invalid answer. Default 1. */
  maxRetries?: number;
}

/**
 * Ask the model for JSON matching `schema`. Retries once with the validation errors fed back.
 * A model that is down or out of quota surfaces as an LlmError; nothing is ever made up in its place.
 */
export async function generateJson<T>(
  opts: GenerateJsonOptions<T>,
  provider: LlmProvider = resolveProvider(),
): Promise<T> {
  return generateJsonWith(opts, provider);
}

async function generateJsonWith<T>(opts: GenerateJsonOptions<T>, provider: LlmProvider): Promise<T> {
  const retries = provider.deterministic ? 0 : (opts.maxRetries ?? 1);
  let user = opts.user;
  let lastError = new LlmError('schema_mismatch', 'No answer was produced');

  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await provider.complete({
      task: opts.task,
      system: opts.system,
      user,
      jsonSchema: () => z.toJSONSchema(opts.schema, { io: 'input' }) as Record<string, unknown>,
    });

    let candidate = raw;
    if (typeof raw === 'string') {
      try {
        candidate = JSON.parse(raw);
      } catch {
        lastError = new LlmError('invalid_json', `The model's answer for "${opts.task}" was not valid JSON.`);
        user = withFeedback(opts.user, 'it was not valid JSON');
        continue;
      }
    }

    const parsed = opts.schema.safeParse(candidate);
    if (parsed.success) return parsed.data;

    const problems = describeIssues(parsed.error.issues);
    lastError = new LlmError('schema_mismatch', `The answer for "${opts.task}" did not match the schema: ${problems}`);
    user = withFeedback(opts.user, problems);
  }

  throw lastError;
}

function describeIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  return issues
    .slice(0, 8)
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
    .slice(0, 800);
}

function withFeedback(originalUser: string, problems: string): string {
  return `${originalUser}\n\nYour previous answer was rejected because ${problems}. Answer again with only the corrected structured result.`;
}
