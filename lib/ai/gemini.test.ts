/** Gemini provider checks. Run: npx tsx --test lib/ai/gemini.test.ts (mocked fetch, no network, no key). */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { z } from 'zod';
import { generateJson, GeminiProvider, isTransientLlmError, LlmError, resolveProvider } from './index';

const Out = z.object({ answer: z.string(), n: z.number() });
const task = { task: 'demo_task', system: 'You answer.', user: 'Question?' };

function fakeFetch(response: { status?: number; json: unknown }) {
  return mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify(response.json), { status: response.status ?? 200, headers: { 'content-type': 'application/json' } }),
  );
}
const ok = (text: string) => ({ json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] } });

describe('resolveProvider', () => {
  it('builds gemini when a key is present and fails clearly without one', () => {
    assert.equal(resolveProvider({ LLM_PROVIDER: 'gemini', LLM_API_KEY: 'k' }).name, 'gemini');
    assert.throws(() => resolveProvider({ LLM_PROVIDER: 'gemini', LLM_API_KEY: '' }), (e) => e instanceof LlmError && e.code === 'config');
  });
});

describe('GeminiProvider', () => {
  afterEach(() => mock.restoreAll());

  it('sends the key in a header (not the URL), asks for JSON and returns the parsed answer', async () => {
    const f = fakeFetch(ok('{"answer":"yes","n":3}'));
    const result = await generateJson({ ...task, schema: Out }, new GeminiProvider({ apiKey: 'secret-key-123', model: 'gemini-test' }));
    assert.deepEqual(result, { answer: 'yes', n: 3 });

    const [url, init] = f.mock.calls[0].arguments as [string, RequestInit];
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    assert.ok(!String(url).includes('secret-key-123'));
    assert.equal((init.headers as Record<string, string>)['x-goog-api-key'], 'secret-key-123');
    const body = JSON.parse(String(init.body));
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.match(body.systemInstruction.parts[0].text, /JSON Schema/);
    assert.equal(body.contents[0].parts[0].text, 'Question?');
  });

  it('accepts an answer wrapped in a code fence', async () => {
    fakeFetch(ok('```json\n{"answer":"fenced","n":1}\n```'));
    assert.deepEqual(await generateJson({ ...task, schema: Out }, new GeminiProvider({ apiKey: 'k' })), { answer: 'fenced', n: 1 });
  });

  it('retries once when the first answer does not match the schema', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => {
      calls++;
      const text = calls === 1 ? '{"answer":"x"}' : '{"answer":"x","n":2}';
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    });
    assert.deepEqual(await generateJson({ ...task, schema: Out }, new GeminiProvider({ apiKey: 'k' })), { answer: 'x', n: 2 });
    assert.equal(calls, 2);
  });

  it('turns an API error into a provider_error without leaking the key', async () => {
    fakeFetch({ status: 403, json: { error: { message: 'API key not valid' } } });
    await assert.rejects(
      generateJson({ ...task, schema: Out }, new GeminiProvider({ apiKey: 'secret-key-123' })),
      (e) => e instanceof LlmError && e.code === 'provider_error' && e.status === 403 && !e.message.includes('secret-key-123'),
    );
  });

  it('reports blocked prompts, empty answers and truncation', async () => {
    const p = new GeminiProvider({ apiKey: 'k' });
    const call = { ...task, jsonSchema: () => ({}) };
    fakeFetch({ json: { promptFeedback: { blockReason: 'SAFETY' } } });
    await assert.rejects(p.complete(call), /blocked/);
    mock.restoreAll();
    fakeFetch({ json: { candidates: [] } });
    await assert.rejects(p.complete(call), /no content/);
    mock.restoreAll();
    fakeFetch({ json: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] } });
    await assert.rejects(p.complete(call), /cut off/);
  });
});

describe('timeouts and fallbacks', () => {
  afterEach(() => {
    mock.restoreAll();
    delete process.env.LLM_FALLBACK_TO_MOCK;
  });
  const okBody = (text: string) => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });

  it('classifies transient errors', () => {
    assert.equal(isTransientLlmError(new LlmError('provider_error', 'LLM request timed out')), true);
    assert.equal(isTransientLlmError(new LlmError('provider_error', 'x', 503)), true);
    assert.equal(isTransientLlmError(new LlmError('provider_error', 'x', 429)), true);
    assert.equal(isTransientLlmError(new LlmError('provider_error', 'x', 403)), false);
    assert.equal(isTransientLlmError(new LlmError('config', 'no key')), false);
  });

  it('retries once on the fallback model after an overload, and uses low thinking on Gemini 3', async () => {
    const models: string[] = [];
    const bodies: any[] = [];
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      models.push(String(url).split('/models/')[1].split(':')[0]);
      bodies.push(JSON.parse(String(init.body)));
      return models.length === 1
        ? new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 })
        : new Response(okBody('{"answer":"ok","n":1}'), { status: 200 });
    });
    const p = new GeminiProvider({ apiKey: 'k', model: 'gemini-3.1-flash-lite', fallbackModel: 'gemini-3-flash-preview' });
    assert.deepEqual(await generateJson({ ...task, schema: Out }, p), { answer: 'ok', n: 1 });
    assert.deepEqual(models, ['gemini-3.1-flash-lite', 'gemini-3-flash-preview']);
    assert.deepEqual(bodies[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  });

  it('does not retry a bad key on the fallback model', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 });
    });
    await assert.rejects(generateJson({ ...task, schema: Out, mock: () => ({ answer: 'm', n: 0 }) }, new GeminiProvider({ apiKey: 'k' })));
    assert.equal(calls, 1);
  });

  it('falls back to the mock answer when both models are unavailable', async () => {
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 }));
    const warn = mock.method(console, 'warn', () => {});
    const r = await generateJson({ ...task, schema: Out, mock: () => ({ answer: 'mock', n: 0 }) }, new GeminiProvider({ apiKey: 'k' }));
    assert.deepEqual(r, { answer: 'mock', n: 0 });
    assert.ok(warn.mock.calls.some((c) => String(c.arguments[0]).includes('offline mock')));
  });

  it('LLM_FALLBACK_TO_MOCK=false surfaces the error instead', async () => {
    process.env.LLM_FALLBACK_TO_MOCK = 'false';
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 }));
    mock.method(console, 'warn', () => {});
    await assert.rejects(
      generateJson({ ...task, schema: Out, mock: () => ({ answer: 'mock', n: 0 }) }, new GeminiProvider({ apiKey: 'k' })),
      (e) => e instanceof LlmError && e.status === 503,
    );
  });
});
