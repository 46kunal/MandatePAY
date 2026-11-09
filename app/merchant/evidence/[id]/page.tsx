'use client';
// OWNER: C. One evidence summary as a standalone, printable page.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, apiFetch } from '@/fixtures/api';
import type { CaseDetail } from '@/fixtures';
import { Card, EmptyState, Notice, PageHeader, Skeleton } from '../../../_ui/Ui';
import { errMsg } from '../../../_ui/useCases';
import { EvidenceSummary } from '../../_components/EvidenceSummary';
import u from '../../../_ui/ui.module.css';
import m from '../../merchant.module.css';

export default function EvidencePage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<{ notFound: boolean; text: string } | null>(null);
  const [fixtures, setFixtures] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const r = await apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`, { signal });
        if (r.fromFixture) setFixtures(true);
        if (!r.data) throw new ApiClientError(404, { error: 'case_not_found' });
        setDetail(r.data);
      } catch (e) {
        if (signal?.aborted) return;
        setError({ notFound: e instanceof ApiClientError && e.status === 404, text: errMsg(e) });
      }
    },
    [id],
  );

  useEffect(() => {
    const ctl = new AbortController();
    void load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  return (
    <>
      <Link href="/merchant/evidence" className={`${u.crumb} ${u.noPrint}`}>
        ← All evidence reports
      </Link>
      <PageHeader
        title="Evidence summary"
        subtitle={id}
        actions={
          detail && (
            <button className={`${u.btn} ${u.noPrint}`} onClick={() => window.print()}>
              Print or save as PDF
            </button>
          )
        }
      />
      {fixtures && <Notice tone="warn">Sample data: the disputes service is not available, so an example dispute is shown.</Notice>}
      {error && (
        <Card>
          <EmptyState
            title={error.notFound ? 'Dispute not found' : 'Could not load this summary'}
            action={!error.notFound ? <button className={u.btn} onClick={() => load()}>Try again</button> : undefined}
          >
            {error.notFound ? `There is no dispute called ${id}.` : error.text}
          </EmptyState>
        </Card>
      )}
      {!detail && !error && (
        <div className={m.skelStack} aria-busy="true" aria-label="Loading evidence summary">
          <Skeleton height={240} />
        </div>
      )}
      {detail && <EvidenceSummary detail={detail} />}
    </>
  );
}
