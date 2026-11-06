/**
 * Prompt-injection hardening for the analyst (owner: B, B11).
 *
 * Dispute messages, item names and merchant text are written by outsiders, so they are DATA. Three layers:
 *  1. The system prompt tells the model to ignore instructions inside the input (see analyst.ts).
 *  2. sanitizeInput() strips control characters and caps field length before the model sees them.
 *  3. scanForInjection() flags text that looks like instructions. A flag forces a human review in enforce(),
 *     so even a model that obeys the injected text cannot trigger an automatic action.
 * Layer 3 is the one that does not depend on the model behaving.
 */
import type { AnalystInput } from './analyst';

export const MAX_FIELD_LENGTH = 1000;

const PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|the|your)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|mandate|guidelines?|constraints?)\b/i,
  /\bnew\s+instructions?\b/i,
  /\bsystem\s*(prompt|message|override)\b/i,
  /^\s*(system|assistant|developer)\s*:/im,
  /<\/?\s*(system|assistant|developer|instructions?)\s*>/i,
  /\byou\s+(are|must)\s+now\b/i,
  /\bact\s+as\b/i,
  /\b(set|change|make)\b[^.\n]{0,30}\b(confidence|needs_human|fault|verdict)\b/i,
  /\b(needs_human|allowed_actions|evidence_points)\b/i,
  /\b(approve|accept|grant|issue)\b[^.\n]{0,25}\b(claim|refund|offer)\b[^.\n]{0,25}\b(immediately|now|in full|fully|without)\b/i,
];

/** Control characters plus zero-width and bidi-override characters, but not newline or tab. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Remove control characters and cap the length. Newlines and tabs are kept. */
export function sanitizeText(text: string, max = MAX_FIELD_LENGTH): string {
  const clean = text.replace(CONTROL_CHARS, '');
  return clean.length > max ? `${clean.slice(0, max)}…[truncated]` : clean;
}

export function looksLikeInjection(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}

/** Every free-text field in the input that an outsider could have written, as [path, text]. */
function untrustedFields(input: AnalystInput): [string, string][] {
  const out: [string, string][] = [];
  input.dispute.messages.forEach((m, i) => out.push([`dispute.messages[${i}].text`, m.text]));
  input.cart.items.forEach((item, i) => {
    out.push([`cart.items[${i}].name`, item.name]);
    for (const [k, v] of Object.entries(item.attributes ?? {})) out.push([`cart.items[${i}].attributes.${k}`, v]);
  });
  if (input.cart.merchant) out.push(['cart.merchant', input.cart.merchant]);
  if (input.mandate.constraints.request_text) out.push(['mandate.constraints.request_text', input.mandate.constraints.request_text]);
  return out;
}

/** Paths of fields that look like injected instructions. Empty when the input looks clean. */
export function scanForInjection(input: AnalystInput): string[] {
  return untrustedFields(input)
    .filter(([, text]) => looksLikeInjection(text))
    .map(([path]) => path);
}

/** Copy of the input with every outsider-written string sanitised. The original is left untouched. */
export function sanitizeInput(input: AnalystInput): AnalystInput {
  return {
    ...input,
    dispute: { ...input.dispute, messages: input.dispute.messages.map((m) => ({ ...m, text: sanitizeText(m.text) })) },
    cart: {
      ...input.cart,
      merchant: input.cart.merchant ? sanitizeText(input.cart.merchant, 200) : input.cart.merchant,
      items: input.cart.items.map((item) => ({
        ...item,
        name: sanitizeText(item.name, 200),
        attributes: item.attributes
          ? Object.fromEntries(Object.entries(item.attributes).map(([k, v]) => [k, sanitizeText(v, 200)]))
          : item.attributes,
      })),
    },
  };
}
