'use client';
// OWNER: C. Mandate ledger. There is no "list mandates" API yet, so this shows the mandates behind disputed orders,
// read from each dispute's detail. The signed token itself stays on the server.
import Link from 'next/link';
import { Badge, Card, EmptyState, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import { CHECK_RESULT, formatDateTime } from '../../_ui/labels';
import { parseCase, summariseConstraints } from '../../_ui/parse';
import { useCaseDetails, useCases } from '../../_ui/useCases';
import u from '../../_ui/ui.module.css';
import m from '../merchant.module.css';

const GUARD_LABEL = { allow: 'Passed', escalate: 'Buyer approved', block: 'Blocked' } as const;

export default function LedgerPage() {
  const { cases, error, reload } = useCases();
  const { details, failed } = useCaseDetails(cases);
  const rows = details?.filter((d) => d.mandate) ?? null;

  return (
    <>
      <PageHeader title="Mandate ledger" subtitle="The signed purchase limits behind each disputed order." />
      <Notice tone="info">
        Only mandates behind disputed orders are listed here. The full ledger will appear once a mandates service is connected.
      </Notice>
      {error && (
        <Notice tone="bad" alert>
          Could not load the ledger: {error}{' '}
          <button className={`${u.btn} ${u.btnSecondary}`} onClick={reload}>
            Try again
          </button>
        </Notice>
      )}
      {failed > 0 && <Notice tone="warn">{failed} mandate{failed === 1 ? '' : 's'} could not be loaded.</Notice>}

      {!rows && !error && (
        <div className={m.skelStack} aria-busy="true" aria-label="Loading ledger">
          <Skeleton height={40} />
          <Skeleton height={56} />
        </div>
      )}

      {rows && rows.length === 0 && (
        <Card>
          <EmptyState title="No mandates to show">Mandates appear here when one of their orders is disputed.</EmptyState>
        </Card>
      )}

      {rows && rows.length > 0 && (
        <Card flush>
          <div className={u.tableWrap}>
            <table className={u.table}>
              <thead>
                <tr>
                  <th scope="col">Mandate</th>
                  <th scope="col">What the buyer authorised</th>
                  <th scope="col">Cart check</th>
                  <th scope="col">Approved by</th>
                  <th scope="col">Valid until</th>
                  <th scope="col">Dispute</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const { constraints, guard } = parseCase(d);
                  return (
                    <tr key={d.mandate!.mandate_id + d.dispute_id}>
                      <td className={u.mono}>{d.mandate!.mandate_id}</td>
                      <td style={{ maxWidth: 360 }}>{constraints ? summariseConstraints(constraints) : <span className={u.muted}>Could not read</span>}</td>
                      <td>
                        {guard ? (
                          <Badge tone={guard.verdict === 'allow' ? 'good' : guard.verdict === 'block' ? 'bad' : CHECK_RESULT.escalate.tone}>
                            {GUARD_LABEL[guard.verdict]}
                          </Badge>
                        ) : (
                          <span className={u.muted}>—</span>
                        )}
                      </td>
                      <td>{d.cart?.approved_by === 'buyer' ? 'Buyer' : d.cart?.approved_by === 'agent' ? 'Agent (within limits)' : '—'}</td>
                      <td className={u.muted}>{formatDateTime(d.mandate!.expires_at)}</td>
                      <td>
                        <Link href={`/merchant/disputes/${encodeURIComponent(d.dispute_id)}`} className={u.rowLink}>
                          {d.dispute_id}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
