'use client';
// OWNER: C. Merchant view: case list. Rows open the case detail at /merchant/[id] (C5).
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CaseRecord, PollDisputesResponse } from '@/contracts/schemas';
import type { z } from 'zod';
import { ApiClientError, apiFetch } from '@/fixtures/api';
import { Badge, Shell } from '../_ui/Shell';
import { FAULT, STATUS, formatMoney, formatWhen, needsReview, reasonLabel } from '../_ui/labels';
import u from '../_ui/ui.module.css';
import s from './merchant.module.css';

type Poll = z.infer<typeof PollDisputesResponse>;

function errMsg(e: unknown): string {
  if (e instanceof ApiClientError) return e.body.message ?? e.body.error ?? `Request failed (${e.status})`;
  return e instanceof Error ? e.message : 'Something went wrong';
}

export default function MerchantPage() {
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollMsg, setPollMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fixtures, setFixtures] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const r = await apiFetch<CaseRecord[]>('/api/cases', { signal });
      if (r.fromFixture) setFixtures(true);
      setCases([...r.data].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
    } catch (e) {
      if (signal?.aborted) return;
      setLoadError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    void load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  async function poll() {
    setPolling(true);
    setPollMsg(null);
    try {
      const r = await apiFetch<Poll>('/api/disputes/poll', { method: 'POST' });
      if (r.fromFixture) setFixtures(true);
      const { fetched, new_cases, linked } = r.data;
      setPollMsg({
        ok: true,
        text:
          new_cases > 0
            ? `Found ${new_cases} new dispute${new_cases === 1 ? '' : 's'} (${fetched} checked, ${linked} linked to an order).`
            : `Up to date: ${fetched} dispute${fetched === 1 ? '' : 's'} checked, none new.`,
      });
      await load();
    } catch (e) {
      setPollMsg({ ok: false, text: `Could not check PayPal: ${errMsg(e)}` });
    } finally {
      setPolling(false);
    }
  }

  const toReview = cases?.filter(needsReview).length ?? 0;

  return (
    <Shell active="merchant">
      <div className={u.pageHead}>
        <div>
          <h1 className={u.h1}>Disputes</h1>
          <p className={u.sub}>Each case is checked against the buyer&apos;s signed mandate.</p>
        </div>
        <div className={s.actions}>
          <button className={`${u.btn} ${u.btnGhost}`} onClick={() => load()} disabled={polling}>
            Refresh
          </button>
          <button className={u.btn} onClick={poll} disabled={polling}>
            {polling ? 'Checking PayPal…' : 'Poll disputes'}
          </button>
        </div>
      </div>

      {fixtures && (
        <div className={u.notice} role="status">
          Sample data: the disputes service is not available, so example cases are shown.
        </div>
      )}
      {pollMsg && (
        <div className={`${u.notice} ${pollMsg.ok ? u.noticeGood : u.noticeBad}`} role="status">
          {pollMsg.text}
        </div>
      )}

      {cases && cases.length > 0 && (
        <div className={s.summary}>
          <div className={`${u.card} ${s.stat}`}>
            <div className={s.statNum}>{cases.length}</div>
            <div className={u.muted}>Total cases</div>
          </div>
          <div className={`${u.card} ${s.stat}`}>
            <div className={s.statNum}>{toReview}</div>
            <div className={u.muted}>Need your review</div>
          </div>
        </div>
      )}

      {loadError && (
        <div className={`${u.notice} ${u.noticeBad}`} role="alert">
          Could not load disputes: {loadError}{' '}
          <button className={`${u.btn} ${u.btnGhost}`} onClick={() => load()}>
            Try again
          </button>
        </div>
      )}

      {!cases && !loadError && (
        <div className={`${u.card} ${s.list}`} aria-busy="true" aria-label="Loading disputes">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${u.skeleton} ${s.skelRow}`} />
          ))}
        </div>
      )}

      {cases && cases.length === 0 && (
        <div className={`${u.card} ${u.empty}`}>
          <h2>No disputes yet</h2>
          <p className={u.muted}>Click &ldquo;Poll disputes&rdquo; to pull new ones from PayPal.</p>
        </div>
      )}

      {cases && cases.length > 0 && (
        <ul className={`${u.card} ${s.list}`}>
          <li className={s.head} aria-hidden="true">
            <span>Reason</span>
            <span>Status</span>
            <span>Amount</span>
            <span>AI verdict</span>
            <span>Opened</span>
          </li>
          {cases.map((c) => {
            const status = STATUS[c.analysis_status];
            const fault = c.verdict ? FAULT[c.verdict.fault] : null;
            return (
              <li key={c.dispute_id}>
                <Link
                  href={`/merchant/${encodeURIComponent(c.dispute_id)}`}
                  className={`${s.row} ${needsReview(c) ? s.rowReview : ''}`}
                >
                  <span>
                    <span className={s.reason}>{reasonLabel(c.reason)}</span>
                    <br />
                    <span className={u.muted}>{c.dispute_id}</span>
                  </span>
                  <span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </span>
                  <span className={s.amount}>{c.amount ? formatMoney(c.amount.value, c.amount.currency) : '—'}</span>
                  <span>
                    {fault ? (
                      <>
                        <Badge tone={fault.tone}>{fault.label}</Badge>
                        <br />
                        <span className={u.muted}>{Math.round((c.verdict?.confidence ?? 0) * 100)}% confident</span>
                      </>
                    ) : (
                      <span className={u.muted}>No verdict yet</span>
                    )}
                  </span>
                  <span className={`${u.muted} ${s.opened}`}>
                    {formatWhen(c.created_at)}
                    <span className={s.chev} aria-hidden="true">
                      ›
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
