'use client';
// OWNER: C. Small reusable building blocks: Badge, Card, PageHeader, Notice, EmptyState, StatCard, Skeleton, ResultMark.
import type { ReactNode } from 'react';
import type { Tone } from './labels';
import u from './ui.module.css';

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`${u.badge} ${u[tone]}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={u.pageHeader}>
      <div>
        <h1 className={u.h1}>{title}</h1>
        {subtitle && <p className={u.sub}>{subtitle}</p>}
      </div>
      {actions && <div className={u.headerActions}>{actions}</div>}
    </div>
  );
}

export function Card({
  id,
  title,
  subtitle,
  actions,
  flush,
  children,
}: {
  id?: string;
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** No inner padding: for tables that should touch the card edges. */
  flush?: boolean;
  children: ReactNode;
}) {
  const headId = id ? `${id}-h` : undefined;
  return (
    <section className={u.card} id={id} aria-labelledby={title ? headId : undefined}>
      {title && (
        <div className={u.cardHead}>
          <div>
            <h2 className={u.cardTitle} id={headId}>
              {title}
            </h2>
            {subtitle && <p className={u.cardSub}>{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={flush ? u.cardFlush : u.cardBody}>{children}</div>
    </section>
  );
}

const NOTICE: Record<Tone, string> = {
  good: u.noticeGood,
  bad: u.noticeBad,
  warn: u.noticeWarn,
  info: u.noticeInfo,
  neutral: '',
};

export function Notice({ tone = 'neutral', alert, children }: { tone?: Tone; alert?: boolean; children: ReactNode }) {
  return (
    <div className={`${u.notice} ${NOTICE[tone]}`} role={alert ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={u.empty}>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className={u.stat}>
      <div className={u.statLabel}>{label}</div>
      <div className={u.statValue}>{value}</div>
      {hint && <div className={u.statHint}>{hint}</div>}
    </div>
  );
}

export function Skeleton({ height = 56, label }: { height?: number; label?: string }) {
  return <div className={u.skeleton} style={{ height }} aria-hidden={label ? undefined : true} aria-label={label} />;
}

/** A pass / fail / attention mark with a text label for screen readers. Colour is never the only signal. */
export function ResultMark({ status }: { status: 'pass' | 'fail' | 'unsure' | 'escalate' }) {
  const map = {
    pass: { cls: u.markOk, glyph: '✓', text: 'Passed' },
    fail: { cls: u.markBad, glyph: '✕', text: 'Failed' },
    unsure: { cls: u.markWarn, glyph: '!', text: 'Could not confirm' },
    escalate: { cls: u.markWarn, glyph: '!', text: 'Needs approval' },
  }[status];
  return (
    <span className={`${u.mark} ${map.cls}`} role="img" aria-label={map.text}>
      {map.glyph}
    </span>
  );
}
