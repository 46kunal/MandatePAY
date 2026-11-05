/**
 * Mock provider (owner: B). Lets judges run the whole app with no API key.
 *
 * There is no global registry of answers: each call site passes its own `mock` function to
 * generateJson(), so the canned answer lives next to the prompt it replaces and is typed against
 * the same schema. A call without `mock` fails loudly in mock mode instead of returning nonsense.
 */
import { LlmError, type LlmProvider, type ProviderCall } from './types';

export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly deterministic = true;

  async complete(call: ProviderCall): Promise<unknown> {
    if (!call.mock) {
      throw new LlmError(
        'no_mock_responder',
        `Mock mode has no canned answer for task "${call.task}". Pass a \`mock\` function to generateJson().`,
      );
    }
    return call.mock({ task: call.task, system: call.system, user: call.user });
  }
}
