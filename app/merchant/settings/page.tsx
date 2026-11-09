'use client';
// OWNER: C. Settings. Reports what the server is actually connected to (GET /api/status). Connections are configured
// on the server with environment variables, so nothing here is editable.
import { useEffect, useState } from 'react';
import { Badge, Card, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import u from '../../_ui/ui.module.css';

interface Status {
  paypal_configured: boolean;
  paypal_button_configured: boolean;
  webhooks_configured: boolean;
  llm_provider: string | null;
  llm_model: string | null;
  llm_configured: boolean;
  merchant_name: string | null;
}

function Row({ ok, label, good, bad }: { ok: boolean; label: string; good: string; bad: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {ok ? <Badge tone="good">Connected</Badge> : <Badge tone="bad">Not set</Badge>} <span className={u.muted}>{ok ? good : bad}</span>
      </dd>
    </>
  );
}

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    fetch('/api/status', { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: Status) => setStatus(s))
      .catch(() => !ctl.signal.aborted && setError(true));
    return () => ctl.abort();
  }, []);

  return (
    <>
      <PageHeader title="Settings" subtitle="What this installation is connected to." />
      <Notice tone="info">Connections are configured on the server with environment variables (see .env.example).</Notice>

      {error && (
        <Notice tone="bad" alert>
          Could not read the connection status from the server.
        </Notice>
      )}
      {!status && !error && <Skeleton height={160} label="Loading connection status" />}

      {status && (
        <Card id="connections" title="Connections">
          <dl className={u.kv}>
            <dt>Store name</dt>
            <dd>{status.merchant_name ?? <span className={u.muted}>Not set (MERCHANT_NAME)</span>}</dd>
            <Row
              ok={status.paypal_configured}
              label="PayPal API"
              good="Orders, captures and dispute actions use the PayPal sandbox."
              bad="Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET. Orders and disputes will fail until then."
            />
            <Row
              ok={status.paypal_button_configured}
              label="PayPal button"
              good="Buyers pay with the real PayPal sandbox checkout."
              bad="Set NEXT_PUBLIC_PAYPAL_CLIENT_ID so buyers can pay."
            />
            <Row
              ok={status.webhooks_configured}
              label="Webhooks"
              good="Dispute updates arrive as soon as PayPal sends them."
              bad="Optional. Without PAYPAL_WEBHOOK_ID, use Poll disputes to fetch updates."
            />
            <Row
              ok={status.llm_configured}
              label="AI model"
              good={`Drafting, shopping and dispute analysis use ${status.llm_provider}${status.llm_model ? ` (${status.llm_model})` : ''}.`}
              bad="Set LLM_PROVIDER and LLM_API_KEY. The agent and the analyst cannot run until then."
            />
          </dl>
        </Card>
      )}
    </>
  );
}
