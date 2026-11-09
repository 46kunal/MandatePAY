'use client';
// OWNER: C. Settings. There is nothing editable yet, so this page reports what the server is actually connected to.
// It reads GET /api/demo/status and shows no made-up options.
import { useEffect, useState } from 'react';
import { Badge, Card, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import u from '../../_ui/ui.module.css';

interface Status {
  demo: boolean;
  paypal_configured: boolean;
  llm_provider: string;
}

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    fetch('/api/demo/status', { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: Status) => setStatus(s))
      .catch(() => !ctl.signal.aborted && setError(true));
    return () => ctl.abort();
  }, []);

  return (
    <>
      <PageHeader title="Settings" subtitle="What this installation is connected to." />
      <Notice tone="info">There are no editable settings yet. Connections are configured on the server with environment variables.</Notice>

      {error && (
        <Notice tone="bad" alert>
          Could not read the connection status from the server.
        </Notice>
      )}
      {!status && !error && <Skeleton height={160} label="Loading connection status" />}

      {status && (
        <Card id="connections" title="Connections">
          <dl className={u.kv}>
            <dt>Mode</dt>
            <dd>
              {status.demo ? <Badge tone="warn">Demo mode</Badge> : <Badge tone="good">Live sandbox</Badge>}{' '}
              <span className={u.muted}>{status.demo ? 'Sample data can be reset at any time.' : 'Real data. Reset is disabled.'}</span>
            </dd>
            <dt>PayPal</dt>
            <dd>
              {status.paypal_configured ? <Badge tone="good">Sandbox connected</Badge> : <Badge tone="neutral">Not connected</Badge>}{' '}
              <span className={u.muted}>
                {status.paypal_configured ? 'Payments and dispute actions use the PayPal sandbox.' : 'Payments and dispute actions are simulated.'}
              </span>
            </dd>
            <dt>AI analyst</dt>
            <dd>
              {status.llm_provider === 'mock' ? <Badge tone="neutral">Sample analyst</Badge> : <Badge tone="good">{status.llm_provider}</Badge>}{' '}
              <span className={u.muted}>
                {status.llm_provider === 'mock'
                  ? 'A simple offline analyst, not a real model. Good for demos only.'
                  : 'Recommendations come from this provider.'}
              </span>
            </dd>
          </dl>
        </Card>
      )}
    </>
  );
}
