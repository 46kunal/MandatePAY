/**
 * B2 unit checks. Run: npx tsx --test lib/ai/client.test.ts
 * No network and no API key needed.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { z } from 'zod';
import { Constraints } from '../../contracts/schemas';
import { AnthropicProvider, generateJson, LlmError, resolveProvider } from './index';
import type { LlmProvider, ProviderCall } from './types';

const validConstraints = {
  max_total: { value: '50.00', currency: 'GBP' },
  categories: ['shoes'],
};

const draftTask = {
  task: 'draft_mandate',
  system: 'Turn the buyer request into constraints.',
  user: 'white trainers under 50 pounds',
};

/** A provider that replays scripted answers, like a flaky real model. */
function scripted(answers: unknown[]): LlmProvider & { calls: ProviderCall[] } {
  const calls: ProviderCall[] = [];
  return {
    name: 'scripted',
    deterministic: false,
    calls,
    async complete(call) {
      calls.push(call);
      return answers[Math.min(calls.length - 1, answers.length - 1)];
    },
  };
}

describe('provider selection', () => {
  it('uses the mock provider when LLM_PROVIDER is empty or missing', () => {
    assert.equal(resolveProvider({}).name, 'mock');
    assert.equal(resolveProvider({ LLM_PROVIDER: '' }).name, 'mock');
    assert.equal(resolveProvider({ LLM_PROVIDER: '  ' }).name, 'mock');
  });

  it('accepts LLM_PROVIDER=mock in any case', () => {
    assert.equal(resolveProvider({ LLM_PROVIDER: 'MOCK' }).name, 'mock');
  });

  it('builds the anthropic provider when a key is present', () => {
    assert.equal(resolveProvider({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'sk-test' }).name, 'anthropic');
  });

  it('fails with a config error when anthropic has no key', () => {
    assert.throws(
      () => resolveProvider({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: '' }),
      (err) => err instanceof LlmError && err.code === 'config',
    );
  });

  it('fails with a config error for an unknown provider', () => {
    assert.throws(
      () => resolveProvider({ LLM_PROVIDER: 'carrier-pigeon' }),
      (err) => err instanceof LlmError && err.code === 'config' && /carrier-pigeon/.test(err.message),
    );
  });
});

describe('generateJson with LLM_PROVIDER=mock', () => {
  const provider = resolveProvider({ LLM_PROVIDER: 'mock' });

  it('returns the canned answer, validated against the contract schema', async () => {
    const result = await generateJson(
      { ...draftTask, schema: Constraints, mock: () => validConstraints },
      provider,
    );
    assert.deepEqual(result, validConstraints);
  });

  it('passes the prompts to the canned responder', async () => {
    let seen = '';
    await generateJson(
      {
        ...draftTask,
        schema: Constraints,
        mock: (input) => {
          seen = `${input.task}|${input.user}`;
          return validConstraints;
        },
      },
      provider,
    );
    assert.equal(seen, 'draft_mandate|white trainers under 50 pounds');
  });

  it('supports async canned responders', async () => {
    const result = await generateJson(
      { ...draftTask, schema: Constraints, mock: async () => validConstraints },
      provider,
    );
    assert.deepEqual(result, validConstraints);
  });

  it('fails loudly when a task has no canned answer', async () => {
    await assert.rejects(
      () => generateJson({ ...draftTask, schema: Constraints }, provider),
      (err) => err instanceof LlmError && err.code === 'no_mock_responder',
    );
  });

  it('rejects a canned answer that breaks the schema, without retrying', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        generateJson(
          {
            ...draftTask,
            schema: Constraints,
            mock: () => {
              calls++;
              return { ...validConstraints, surprise: true }; // Constraints is .strict()
            },
          },
          provider,
        ),
      (err) => err instanceof LlmError && err.code === 'schema_mismatch',
    );
    assert.equal(calls, 1);
  });
});

describe('generateJson validation and retry', () => {
  it('retries once with the validation errors fed back, then succeeds', async () => {
    const provider = scripted([{ max_total: { value: '50', currency: 'GBP' } }, validConstraints]);
    const result = await generateJson({ ...draftTask, schema: Constraints }, provider);

    assert.deepEqual(result, validConstraints);
    assert.equal(provider.calls.length, 2);
    assert.equal(provider.calls[0].user, draftTask.user);
    assert.match(provider.calls[1].user, /rejected/);
    assert.match(provider.calls[1].user, /max_total/);
  });

  it('gives up after the retry budget with schema_mismatch', async () => {
    const provider = scripted([{ nonsense: true }]);
    await assert.rejects(
      () => generateJson({ ...draftTask, schema: Constraints }, provider),
      (err) => err instanceof LlmError && err.code === 'schema_mismatch',
    );
    assert.equal(provider.calls.length, 2); // first try + 1 retry
  });

  it('honours maxRetries: 0', async () => {
    const provider = scripted([{ nonsense: true }]);
    await assert.rejects(() => generateJson({ ...draftTask, schema: Constraints, maxRetries: 0 }, provider));
    assert.equal(provider.calls.length, 1);
  });

  it('parses a JSON string answer', async () => {
    const provider = scripted([JSON.stringify(validConstraints)]);
    const result = await generateJson({ ...draftTask, schema: Constraints }, provider);
    assert.deepEqual(result, validConstraints);
  });

  it('reports invalid_json when the model returns text that is not JSON', async () => {
    const provider = scripted(['Sure! Here is your mandate.']);
    await assert.rejects(
      () => generateJson({ ...draftTask, schema: Constraints }, provider),
      (err) => err instanceof LlmError && err.code === 'invalid_json',
    );
  });

  it('returns the parsed value, so schema defaults are applied', async () => {
    const Small = z.object({ warnings: z.array(z.string()).default([]), n: z.number() });
    const result = await generateJson({ ...draftTask, schema: Small, mock: () => ({ n: 1 }) }, resolveProvider({}));
    assert.deepEqual(result, { warnings: [], n: 1 });
  });
});

// z.toJSONSchema only exists in zod 4, which this repo uses. Skipped (not failed) on an older zod.
const hasToJsonSchema = typeof (z as unknown as { toJSONSchema?: unknown }).toJSONSchema === 'function';

describe('anthropic provider request shape', { skip: !hasToJsonSchema && 'needs zod 4 (z.toJSONSchema)' }, () => {
  afterEach(() => mock.restoreAll());

  function fakeFetch(response: { status?: number; json: unknown }) {
    return mock.method(globalThis, 'fetch', async () =>
      new Response(JSON.stringify(response.json), {
        status: response.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('forces a tool call named after the task and returns the tool input', async () => {
    const fetchMock = fakeFetch({
      json: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'draft_mandate', input: validConstraints }] },
    });
    const provider = new AnthropicProvider({ apiKey: 'sk-secret-test', model: 'test-model' });

    const result = await generateJson({ ...draftTask, schema: Constraints }, provider);
    assert.deepEqual(result, validConstraints);

    const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    assert.equal(headers['x-api-key'], 'sk-secret-test');
    assert.ok(headers['anthropic-version']);

    const body = JSON.parse(String(init.body));
    assert.equal(body.model, 'test-model');
    assert.deepEqual(body.tool_choice, { type: 'tool', name: 'draft_mandate' });
    assert.equal(body.tools[0].name, 'draft_mandate');
    assert.equal(body.tools[0].input_schema.type, 'object');
    assert.equal('$schema' in body.tools[0].input_schema, false);
  });

  it('turns an API error into provider_error without leaking the key', async () => {
    fakeFetch({ status: 401, json: { error: { message: 'invalid x-api-key' } } });
    const provider = new AnthropicProvider({ apiKey: 'sk-secret-test' });

    await assert.rejects(
      () => generateJson({ ...draftTask, schema: Constraints }, provider),
      (err) => err instanceof LlmError && err.code === 'provider_error' && err.status === 401 && !err.message.includes('sk-secret-test'),
    );
  });

  it('fails when the model returns no tool call', async () => {
    fakeFetch({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hello' }] } });
    const provider = new AnthropicProvider({ apiKey: 'sk-secret-test' });

    await assert.rejects(
      () => generateJson({ ...draftTask, schema: Constraints }, provider),
      (err) => err instanceof LlmError && err.code === 'provider_error',
    );
  });
});
