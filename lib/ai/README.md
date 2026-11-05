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
  mock: ({ user }) => cannedDraftFor(user),   // used when LLM_PROVIDER=mock
});
```

## Environment

| Variable | Meaning |
|---|---|
| `LLM_PROVIDER` | `mock` or `anthropic`. Empty means `mock`, so a fresh clone runs with no key. |
| `LLM_API_KEY` | Required for `anthropic`. |
| `LLM_MODEL` | Optional model override. |

## Behaviour

- **Mock mode:** each call site passes its own `mock` function, typed against the same schema. A call with no `mock`
  fails with `no_mock_responder` instead of returning nonsense. The canned answer is validated like a real one.
- **Strict output:** the answer is validated with Zod. On failure it retries once with the validation errors fed back
  (real providers only), then throws `LlmError`.
- **Errors:** `LlmError.code` is one of `config`, `provider_error`, `invalid_json`, `schema_mismatch`, `no_mock_responder`.
  Routes return 502 for all of these except `config`.
- **Anthropic provider:** forced tool use with the Zod schema as `input_schema`. Add another provider by implementing
  `LlmProvider` and adding a case in `resolveProvider`.
- **Trust:** the model decides nothing on its own. Guard rules and mandate signing stay deterministic; callers validate
  everything that comes back.

## Tests

```bash
npx tsx --test lib/ai/client.test.ts
```
