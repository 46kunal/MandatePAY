/**
 * Audit log (owner: orchestrator). One append-only row per important change. Callers pass the acting user (or
 * null for the system) and what changed; details must never contain secrets.
 */
import { randomUUID } from 'node:crypto';

export interface AuditActor {
  id: string;
  email: string;
}

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

export interface AuditRecord {
  id: string;
  at: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
}

/** Best effort: a failed audit write is logged, never allowed to undo the change it describes. */
export async function audit(actor: AuditActor | null, entry: AuditEntry): Promise<void> {
  try {
    const { db, schema } = await import('../db/client');
    await db.insert(schema.auditLog).values({
      id: randomUUID(),
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      details: entry.details ?? null,
    });
  } catch (err) {
    console.error(`[audit] could not record ${entry.action}: ${(err as Error).message}`);
  }
}

export async function listAudit(limit = 200): Promise<AuditRecord[]> {
  const [{ desc }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../db/client')]);
  const rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.at)).limit(Math.min(limit, 1000));
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    actor_email: r.actorEmail,
    action: r.action,
    target_type: r.targetType,
    target_id: r.targetId,
    details: r.details ?? null,
  }));
}
