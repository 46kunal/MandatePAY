/** Typed, validated environment (owner: orchestrator). Import getConfig() instead of reading process.env. */
import { z } from 'zod';
import { Amount } from '../contracts/schemas';

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_BASE_URL: z.string().url().default('https://api-m.sandbox.paypal.com'),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  APPROVAL_THRESHOLD: Amount.default('100.00'),
  KEY_DIR: z.string().default('.keys'),
  LLM_PROVIDER: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
});

export type Config = z.infer<typeof Env>;

let cached: Config | undefined;

export function getConfig(): Config {
  if (cached) return cached;
  const env = Env.parse(process.env);

  // The hackathon is sandbox-only. Refuse anything that is not the PayPal sandbox
  // (or a local mock server used in tests).
  const host = new URL(env.PAYPAL_BASE_URL).hostname;
  const isSandbox = host.includes('sandbox');
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (!isSandbox && !isLocal) {
    throw new Error(
      `Refusing to run: PAYPAL_BASE_URL (${host}) is not the PayPal sandbox. This project is sandbox-only.`,
    );
  }

  cached = env;
  return env;
}
