'use client';
// OWNER: C. Data hooks for the merchant dashboard. They call the real API through apiFetch (which only falls back to
// sample data when the backend is not reachable, and says so via `fixtures`).
import { useCallback, useEffect, useState } from 'react';
import type { CaseRecord } from '@/contracts/schemas';
import type { CaseDetail } from '@/fixtures';
import { ApiClientError, apiFetch } from '@/fixtures/api';

export function errMsg(e: unknown): string {
  if (e instanceof ApiClientError) return e.body.message ?? e.body.error ?? `Request failed (${e.status})`;
  return e instanceof Error ? e.message : 'Something went wrong';
}

export function useCases() {
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const r = await apiFetch<CaseRecord[]>('/api/cases', { signal });
      if (r.fromFixture) setFixtures(true);
      setCases([...r.data].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
    } catch (e) {
      if (signal?.aborted) return;
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    void load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  return { cases, error, fixtures, reload: () => load(), setCases };
}

/** Fetches the detail (mandate, cart, order) of every case. Used by Orders, Mandate ledger and Evidence reports. */
export function useCaseDetails(cases: CaseRecord[] | null) {
  const [details, setDetails] = useState<CaseDetail[] | null>(null);
  const [failed, setFailed] = useState(0);

  const ids = cases?.map((c) => c.dispute_id).join('|') ?? null;
  useEffect(() => {
    if (!cases) return;
    const ctl = new AbortController();
    setDetails(null);
    Promise.allSettled(
      cases.map((c) => apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(c.dispute_id)}`, { signal: ctl.signal })),
    ).then((rs) => {
      if (ctl.signal.aborted) return;
      setDetails(rs.flatMap((r) => (r.status === 'fulfilled' && r.value.data ? [r.value.data] : [])));
      setFailed(rs.filter((r) => r.status === 'rejected').length);
    });
    return () => ctl.abort();
    // `ids` is the stable identity of the list: refetch only when the set of cases changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return { details, failed };
}
