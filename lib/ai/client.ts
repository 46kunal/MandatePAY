/**
 * LLM entry point (owner: B): pick a provider from the environment, ask for JSON, validate with Zod.
 *
 * Environment (see .env.example):
 *   LLM_PROVIDER  "mock" | "anthropic" | "gemini" | "grok". Empty means mock, so a fresh clone runs with no key.
 *   LLM_API_KEY   required for "anthropic".
 *   LLM_MODEL     optional model override.
 *
 * Callers never see raw model text: generateJson() returns data that already passed the schema, or
 * throws LlmError (routes turn that into HTTP 502).
 */
import { z } from 'zod';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { GrokProvider } from './grok';
import { MockProvider } from './mock';
import { isTransientLlmError, LlmError, type LlmProvider, type LlmRequest } from './types';

type Env = Record<string, string | undefined>;

const clean = (value: string | undefined) => value?.trim() || undefined;

let warnedAboutIgnoredKey = false;

/** Build the provider named by the environment. Pass `env` in tests. */
export function resolveProvider(env: Env = process.env): LlmProvider {
  const name = clean(env.LLM_PROVIDER)?.toLowerCase() ?? 'mock';
  const apiKey = clean(env.LLM_API_KEY);

  switch (name) {
    case 'mock': {
      if (apiKey && !clean(env.LLM_PROVIDER) && !warnedAboutIgnoredKey) {
        warnedAboutIgnoredKey = true;
        console.warn('LLM_API_KEY is set but LLM_PROVIDER is empty: using the mock LLM. Set LLM_PROVIDER=anthropic to use it.');
      }
      return new MockProvider();
    }
    case 'anthropic': {
      if (!apiKey) throw new LlmError('config', 'LLM_PROVIDER=anthropic needs LLM_API_KEY (or use LLM_PROVIDER=mock).');
      return new AnthropicProvider({ apiKey, model: clean(env.LLM_MODEL) });
    }
    case 'gemini': {
      if (!apiKey) throw new LlmError('config', 'LLM_PROVIDER=gemini needs LLM_API_KEY (or use LLM_PROVIDER=mock).');
      return new GeminiProvider({ apiKey, model: clean(env.LLM_MODEL), fallbackModel: env.LLM_FALLBACK_MODEL?.trim() });
    }
    case 'grok': {
      if (!apiKey) throw new LlmError('config', 'LLM_PROVIDER=grok needs LLM_API_KEY (or use LLM_PROVIDER=mock).');
      return new GrokProvider({ apiKey, model: clean(env.LLM_MODEL) });
    }
    default:
      throw new LlmError('config', `Unknown LLM_PROVIDER "${name}". Use "mock", "anthropic", "gemini" or "grok".`);
  }
}

export interface GenerateJsonOptions<T> extends LlmRequest {
  schema: z.ZodType<T>;
  /**
   * Canned answer used when LLM_PROVIDER=mock. Required for anything the demo must run without a key.
   * Its return value is validated against `schema` exactly like a real model answer.
   */
  mock?: (input: LlmRequest) => unknown | Promise<unknown>;
  /** Extra attempts after a malformed or schema-invalid answer (real providers only). Default 1. */
  maxRetries?: number;
}

/**
 * Ask the model for JSON matching `schema`. Retries once with the validation errors fed back.
 *
 * If the real model is temporarily unavailable (timeout, overload, rate limit) and the call site has a mock answer,
 * the mock answers instead so the app keeps working, and a warning is logged. Set LLM_FALLBACK_TO_MOCK=false to
 * get the error instead. Configuration errors and bad keys are never hidden.
 */
export async function generateJson<T>(
  opts: GenerateJsonOptions<T>,
  provider: LlmProvider = resolveProvider(),
): Promise<T> {
  try {
    return await generateJsonWith(opts, provider);
  } catch (err) {
    const fallbackAllowed = process.env.LLM_FALLBACK_TO_MOCK?.trim().toLowerCase() !== 'false';
    if (!fallbackAllowed || provider.deterministic || !opts.mock || !isTransientLlmError(err)) throw err;
    console.warn(`[llm] ${provider.name} unavailable for "${opts.task}" (${(err as Error).message.slice(0, 80)}); using the offline mock answer`);
    return generateJsonWith(opts, new MockProvider());
  }
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
      mock: opts.mock,
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
