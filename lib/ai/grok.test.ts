/** Grok provider checks. Run: npx tsx --test lib/ai/grok.test.ts (mocked fetch, no network, no key). */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { z } from 'zod';
import { generateJson, GrokProvider, LlmError, resolveProvider } from './index';

const Out = z.object({ answer: z.string(), n: z.number() });
const task = { task: 'demo_task', system: 'You answer.', user: 'Question?' };

function fakeFetch(response: { status?: number; json: unknown }) {
  return mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify(response.json), { status: response.status ?? 200, headers: { 'content-type': 'application/json' } }),
  );
}
const ok = (content: string) => ({ json: { choices: [{ finish_reason: 'stop', message: { content } }] } });

describe('resolveProvider', () => {
  it('builds grok when a key is present and fails clearly without one', () => {
    assert.equal(resolveProvider({ LLM_PROVIDER: 'grok', LLM_API_KEY: 'k' }).name, 'grok');
    assert.throws(() => resolveProvider({ LLM_PROVIDER: 'grok', LLM_API_KEY: '' }), (e) => e instanceof LlmError && e.code === 'config');
  });
});

describe('GrokProvider', () => {
  afterEach(() => mock.restoreAll());

  it('posts an OpenAI-style request with a bearer key and returns the parsed answer', async () => {
    const f = fakeFetch(ok('{"answer":"yes","n":3}'));
    const result = await generateJson({ ...task, schema: Out }, new GrokProvider({ apiKey: 'secret-key-123', model: 'grok-test' }));
    assert.deepEqual(result, { answer: 'yes', n: 3 });

    const [url, init] = f.mock.calls[0].arguments as [string, RequestInit];
    assert.equal(url, 'https://api.x.ai/v1/chat/completions');
    assert.equal((init.headers as Record<string, string>).authorization, 'Bearer secret-key-123');
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, 'grok-test');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.messages[0].role, 'system');
    assert.match(body.messages[0].content, /JSON Schema/);
    assert.equal(body.messages[1].content, 'Question?');
  });

  it('accepts an answer wrapped in a code fence', async () => {
    fakeFetch(ok('```json\n{"answer":"fenced","n":1}\n```'));
    assert.deepEqual(await generateJson({ ...task, schema: Out }, new GrokProvider({ apiKey: 'k' })), { answer: 'fenced', n: 1 });
  });

  it('retries once when the first answer does not match the schema', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => {
      calls++;
      const content = calls === 1 ? '{"answer":"x"}' : '{"answer":"x","n":2}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    });
    assert.deepEqual(await generateJson({ ...task, schema: Out }, new GrokProvider({ apiKey: 'k' })), { answer: 'x', n: 2 });
    assert.equal(calls, 2);
  });

  it('turns an API error into a provider_error without leaking the key', async () => {
    fakeFetch({ status: 401, json: { error: 'Incorrect API key provided' } });
    await assert.rejects(
      generateJson({ ...task, schema: Out }, new GrokProvider({ apiKey: 'secret-key-123' })),
      (e) => e instanceof LlmError && e.code === 'provider_error' && e.status === 401 && !e.message.includes('secret-key-123'),
    );
  });

  it('reports empty answers and truncation', async () => {
    const p = new GrokProvider({ apiKey: 'k' });
    const call = { ...task, jsonSchema: () => ({}) };
    fakeFetch({ json: { choices: [] } });
    await assert.rejects(p.complete(call), /no content/);
    mock.restoreAll();
    fakeFetch({ json: { choices: [{ finish_reason: 'length', message: { content: '{' } }] } });
    await assert.rejects(p.complete(call), /cut off/);
  });
});
