/**
 * Minimal PayPal REST client (owner: A): OAuth token cache plus an authenticated fetch.
 * Sandbox only; the host check lives in lib/config.ts and is repeated here so the client is safe on its own.
 */
import { randomUUID } from 'node:crypto';
import { getConfig } from '../config';
import { PayPalConfigError, PayPalError } from './errors';

export interface PayPalConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  webhookId?: string;
  appBaseUrl: string;
}

/** Refresh this many seconds before PayPal says the token expires. */
const EXPIRY_SKEW_SECONDS = 60;

export function assertSandboxHost(baseUrl: string): void {
  const host = new URL(baseUrl).hostname;
  if (!(host.includes('sandbox') || host === 'localhost' || host === '127.0.0.1')) {
    throw new PayPalConfigError(`Refusing to call ${host}: this project is sandbox-only.`);
  }
}

/** Build the client config from validated env. Throws PayPalConfigError if credentials are missing. */
export function paypalConfigFromEnv(): PayPalConfig {
  const c = getConfig();
  if (!c.PAYPAL_CLIENT_ID || !c.PAYPAL_CLIENT_SECRET) {
    throw new PayPalConfigError(
      'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (see docs/PAYPAL_SANDBOX_SETUP.md).',
    );
  }
  return {
    baseUrl: c.PAYPAL_BASE_URL,
    clientId: c.PAYPAL_CLIENT_ID,
    clientSecret: c.PAYPAL_CLIENT_SECRET,
    webhookId: c.PAYPAL_WEBHOOK_ID,
    appBaseUrl: c.APP_BASE_URL,
  };
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  /** JSON body for POST/PATCH. */
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /**
   * Sent as PayPal-Request-Id so a retried POST cannot create a second order or capture.
   * Pass a stable value (e.g. derived from the cart id) when the call must be idempotent.
   */
  requestId?: string;
}

export class PayPalClient {
  readonly config: PayPalConfig;
  private token?: { value: string; expiresAt: number };
  private inflight?: Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(config: PayPalConfig, deps: { fetch?: typeof fetch; now?: () => number } = {}) {
    assertSandboxHost(config.baseUrl);
    this.config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, '') };
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Cached access token. Concurrent callers share one in-flight refresh. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt > this.now()) return this.token.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const res = await this.send(`${this.config.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const data = (await parseBody(res)) as { access_token?: string; expires_in?: number } | undefined;
    if (!res.ok || !data?.access_token) throw toPayPalError(res, data, 'PayPal OAuth failed');
    const ttl = Math.max((data.expires_in ?? 300) - EXPIRY_SKEW_SECONDS, 0);
    this.token = { value: data.access_token, expiresAt: this.now() + ttl * 1000 };
    return data.access_token;
  }

  /** Authenticated JSON request. Retries once with a fresh token on 401. Returns undefined for empty bodies. */
  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(this.config.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const method = opts.method ?? 'GET';
    const requestId = method === 'POST' ? (opts.requestId ?? randomUUID()) : undefined;

    for (let attempt = 0; ; attempt++) {
      const token = await this.getAccessToken(attempt > 0);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      if (requestId) headers['PayPal-Request-Id'] = requestId;

      const res = await this.send(url.toString(), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      if (res.status === 401 && attempt === 0) continue;

      const data = await parseBody(res);
      if (!res.ok) throw toPayPalError(res, data, `PayPal ${method} ${path} failed`);
      return data as T;
    }
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new PayPalError(`PayPal request failed: ${(err as Error).message}`, { status: 0 });
    }
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toPayPalError(res: Response, data: unknown, fallback: string): PayPalError {
  const body = (data && typeof data === 'object' ? data : {}) as {
    name?: string;
    error?: string;
    message?: string;
    error_description?: string;
    details?: unknown;
  };
  const name = body.name ?? body.error;
  const message = body.message ?? body.error_description ?? fallback;
  return new PayPalError(`${message}${name ? ` (${name})` : ''}`, {
    status: res.status,
    paypalName: name,
    debugId: res.headers.get('paypal-debug-id') ?? undefined,
    details: body.details,
  });
}

let shared: PayPalClient | undefined;

/** Process-wide client built from env, so the token cache is shared across requests. */
export function getPayPalClient(): PayPalClient {
  shared ??= new PayPalClient(paypalConfigFromEnv());
  return shared;
}

export function resetPayPalClient(): void {
  shared = undefined;
}
