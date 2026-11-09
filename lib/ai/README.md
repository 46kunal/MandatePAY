# lib/ai (owner: B)

One interface for every LLM call: ask for JSON, get data that already passed a Zod schema.

```ts
import { generateJson } from '@/lib/ai';
import { DraftMandateResponse } from '@/contracts/schemas';

const draft = await generateJson({
  task: 'draft_mandate',            // snake_case; becomes the tool name
  system: '...',
  user: buyerText,
  schema: DraftMandateResponse,
});
```

Used by: mandate drafting (`lib/mandate/draft.ts`), the shopping agent (`lib/agent/shop.ts`), fuzzy matching in the
guard (`lib/mandate/fuzzy.ts`) and the dispute analyst (`lib/analyst/analyst.ts`).

## Environment

| Variable | Meaning |
|---|---|
| `LLM_PROVIDER` | Required: `gemini`, `grok` or `anthropic`. There is no offline stand-in. |
| `LLM_API_KEY` | The provider's key. |
| `LLM_MODEL` | Optional model override (`npx tsx scripts/llm-models.ts` lists what your key can use). |
| `LLM_FALLBACK_MODEL` | Gemini only: a second model tried once on a timeout, 503 or 429. |

## Behaviour

- **Strict output:** the answer is validated with Zod. On failure it retries once with the validation errors fed back,
  then throws `LlmError`.
- **Errors:** `LlmError.code` is one of `config`, `provider_error`, `invalid_json`, `schema_mismatch`. Routes return 500
  for `config` and 502 for the rest. A model that is down is reported, never replaced with made-up output.
- **Providers:** Gemini (JSON output, low thinking on Gemini 3, 60 s timeout, one retry on a fallback model), Grok
  (OpenAI-style JSON output) and Anthropic (forced tool use). Add another by implementing `LlmProvider` and adding a
  case in `resolveProvider`.
- **Trust:** the model decides nothing on its own. Guard rules and mandate signing stay deterministic; callers validate
  everything that comes back.

## Tests

Tests inject a scripted provider or mock `fetch`; they never call a real model.

```bash
npx tsx --test lib/ai/*.test.ts
```
