/**
 * Fetch wrapper (owner: C). Calls the real API; when a route is still unbuilt (HTTP 501)
 * it returns the matching fixture instead, so the UI renders with no backend.
 * Other errors are thrown as ApiClientError so screens can show an error state.
 */
import type { ApiError, Cart, GuardResult } from '../contracts/schemas';
import {
  captureResponse,
  caseDetail,
  cases,
  cartBlocked,
  cartNeedsApproval,
  draftWarnings,
  guardAllow,
  guardBlock,
  guardEscalate,
  mandate,
  mandateConstraints,
  placeOrderCreated,
  placeOrderNeedsApproval,
  pollResponse,
  verdictNotReceived,
} from './index';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public body: Partial<ApiError>,
  ) {
    super(body.message ?? body.error ?? `HTTP ${status}`);
  }
}

export interface ApiResult<T> {
  data: T;
  /** True when the server answered 501 and a fixture was used instead */
  fromFixture: boolean;
}

function pickGuard(cart?: Cart): GuardResult {
  const sku = cart?.items?.[0]?.sku;
  if (sku && sku === cartBlocked.items[0].sku) return guardBlock;
  if (sku && sku === cartNeedsApproval.items[0].sku) return guardEscalate;
  return guardAllow;
}

function idFrom(route: string): string {
  return decodeURIComponent(route.split('/')[3] ?? '');
}

/** Fixture for an unbuilt route, or undefined when there is none. */
export function fixtureFor(method: string, path: string, body?: unknown): unknown {
  const route = path.split('?')[0];
  const m = method.toUpperCase();
  const req = (body ?? {}) as Record<string, any>;

  if (m === 'POST' && route === '/api/mandates/draft') {
    return {
      constraints: { ...mandateConstraints, request_text: req.request_text ?? mandateConstraints.request_text },
      warnings: draftWarnings,
    };
  }
  if (m === 'POST' && route === '/api/mandates') {
    return {
      mandate_id: mandate.mandate_id,
      constraints: req.constraints ?? mandateConstraints,
      expires_at: mandate.expires_at,
    };
  }
  if (m === 'POST' && route === '/api/carts/check') return pickGuard(req.cart);
  if (m === 'POST' && route === '/api/orders') {
    const guard = pickGuard(req.cart);
    if (guard.verdict === 'block') return undefined; // real API answers 422 guard_blocked
    if (guard.verdict === 'escalate' && !req.buyer_approved) return placeOrderNeedsApproval;
    return { ...placeOrderCreated, guard };
  }
  if (m === 'POST' && /^\/api\/orders\/[^/]+\/capture$/.test(route)) return captureResponse;
  if (m === 'POST' && route === '/api/disputes/poll') return pollResponse;
  if (m === 'GET' && route === '/api/cases') return cases;
  if (m === 'GET' && /^\/api\/cases\/[^/]+$/.test(route)) return caseDetail(idFrom(route));
  if (m === 'POST' && /^\/api\/cases\/[^/]+\/analyse$/.test(route)) {
    return caseDetail(idFrom(route))?.verdict ?? verdictNotReceived;
  }
  if (m === 'POST' && /^\/api\/cases\/[^/]+\/act$/.test(route)) {
    const c = cases.find((x) => x.dispute_id === idFrom(route));
    if (!c) return undefined;
    return {
      ...c,
      analysis_status: 'acted',
      action_taken: req.override?.action ?? c.verdict?.action ?? 'NO_ACTION',
      outcome: 'Action sent (fixture)',
    };
  }
  if (m === 'POST' && route === '/api/demo/reset') return { ok: true };
  return undefined;
}

/** Routes that need PayPal and have a demo twin in app/api/demo. */
export function demoTwin(method: string, path: string): string | undefined {
  if (method.toUpperCase() !== 'POST') return undefined;
  const route = path.split('?')[0];
  if (route === '/api/orders') return '/api/demo/orders';
  if (route === '/api/disputes/poll') return '/api/demo/poll';
  const capture = route.match(/^\/api\/orders\/([^/]+)\/capture$/);
  if (capture) return `/api/demo/orders/${capture[1]}/capture`;
  const act = route.match(/^\/api\/cases\/([^/]+)\/act$/);
  if (act) return `/api/demo/cases/${act[1]}/act`;
  return undefined;
}

/** The `error` code of a JSON error response, without consuming the response the caller still needs. */
async function errorCode(res: Response): Promise<string | undefined> {
  try {
    return ((await res.clone().json()) as { error?: string }).error;
  } catch {
    return undefined;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (e) {
    // Network failure (server down): use the fixture if there is one, so the UI still renders.
    if (init.signal?.aborted) throw e;
    const fixture = fixtureFor(method, path, init.body);
    if (fixture !== undefined) return { data: fixture as T, fromFixture: true };
    throw e;
  }

  // No PayPal credentials: the same request goes to the demo twin of the route (app/api/demo), which uses the real
  // database and mandate code with the PayPal call simulated. Its answers (including 409 / 422) are real answers.
  if (res.status === 500) {
    const twinPath = demoTwin(method, path);
    if (twinPath && (await errorCode(res)) === 'paypal_not_configured') {
      try {
        const twin = await fetch(twinPath, {
          method,
          headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: init.signal,
        });
        const code = twin.status === 403 ? await errorCode(twin) : undefined;
        const notAvailable = twin.status >= 500 || code === 'demo_mode_only' || code === 'paypal_configured';
        if (!notAvailable) res = twin;
      } catch (e) {
        if (init.signal?.aborted) throw e;
      }
    }
  }

  // 501 = route not built yet. 500/502/503 = backend unavailable (e.g. no database in demo mode).
  // 502 is excluded for orders/analyse where it means a real PayPal / LLM failure.
  const unavailable = res.status === 501 || res.status === 500 || res.status === 503;
  if (unavailable) {
    const fixture = fixtureFor(method, path, init.body);
    if (fixture !== undefined) return { data: fixture as T, fromFixture: true };
  }

  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    throw new ApiClientError(res.status, (json as Partial<ApiError>) ?? { error: 'http_error', message: text });
  }
  return { data: json as T, fromFixture: false };
}
