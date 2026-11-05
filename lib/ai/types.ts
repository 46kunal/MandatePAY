/** Shared types for the LLM layer (owner: B). */

export type LlmErrorCode =
  /** Bad or missing configuration (unknown provider, missing key). */
  | 'config'
  /** The provider call failed: network, timeout, non-2xx, no tool call returned. */
  | 'provider_error'
  /** The model answered but it was not parseable JSON. */
  | 'invalid_json'
  /** The model answered with JSON that does not match the Zod schema. */
  | 'schema_mismatch'
  /** Mock mode was used for a call that has no canned answer. */
  | 'no_mock_responder';

/** API routes map any LlmError to HTTP 502 (see contracts/api.md), except 'config' which is a 500. */
export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status?: number;

  constructor(code: LlmErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
  }
}

/** What a call site supplies: which task this is and the prompts. */
export interface LlmRequest {
  /** Short stable snake_case name, e.g. "draft_mandate". Used as the tool name and for mock lookups. */
  task: string;
  system: string;
  user: string;
}

/** What a provider receives. jsonSchema is lazy because the mock provider never needs it. */
export interface ProviderCall extends LlmRequest {
  jsonSchema: () => Record<string, unknown>;
  /** Canned answer for mock mode, supplied by the call site. Real providers ignore it. */
  mock?: (input: LlmRequest) => unknown | Promise<unknown>;
}

export interface LlmProvider {
  readonly name: string;
  /** Deterministic providers (mock) give the same answer every time, so retrying is pointless. */
  readonly deterministic: boolean;
  /** Return the model's structured answer: a parsed object, or a JSON string. Validation happens in generateJson. */
  complete(call: ProviderCall): Promise<unknown>;
}
