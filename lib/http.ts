/** Small helpers for API routes (owner: orchestrator). */

export type Owner = 'A' | 'B' | 'C' | 'orchestrator';

/** Placeholder response for routes nobody has built yet. Replace the stub body, keep the route path. */
export function notImplemented(owner: Owner, hint: string) {
  return Response.json({ error: 'not_implemented', owner, hint }, { status: 501 });
}

/** Consistent error body: { error, message, details }. */
export function apiError(status: number, error: string, message?: string, details?: unknown) {
  return Response.json({ error, message, details }, { status });
}
