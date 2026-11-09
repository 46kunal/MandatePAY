// Lists the model ids your LLM key can use, so you can set LLM_MODEL. Prints ids only, never the key.
// Run with: npx tsx scripts/llm-models.ts   (reads LLM_PROVIDER and LLM_API_KEY from .env; grok or gemini)
import 'dotenv/config';

async function main() {
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();
  const key = process.env.LLM_API_KEY?.trim();
  if (!key) return void console.error('LLM_API_KEY is not set in .env');

  let res: Response;
  if (provider === 'grok') {
    res = await fetch('https://api.x.ai/v1/models', { headers: { authorization: `Bearer ${key}` } });
  } else if (provider === 'gemini') {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': key } });
  } else {
    return void console.error('Set LLM_PROVIDER=grok or gemini in .env first');
  }
  const body = (await res.json().catch(() => ({}))) as { data?: { id: string }[]; models?: { name: string }[]; error?: unknown };
  if (!res.ok) return void console.error(`HTTP ${res.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  const ids = provider === 'grok' ? (body.data ?? []).map((m) => m.id) : (body.models ?? []).map((m) => m.name.replace(/^models\//, ''));
  console.log(ids.join('\n') || '(no models returned)');
}

void main();
