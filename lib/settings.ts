/**
 * Store settings (owner: A). One row in the `settings` table; any value still null falls back to the environment
 * default, so a fresh database behaves exactly like before. Secrets are never settings.
 *
 * Reads are cached for a few seconds per server instance. An update clears this instance's cache; other
 * instances pick the change up when their cache expires.
 */
import type { StoreSettings, UpdateStoreSettingsRequest } from '../contracts/schemas';
import { fromMinor, toMinor } from './mandate/money';

export const DEFAULTS = { humanReviewOver: '100.00', minConfidence: 0.7, autoAnalyse: true } as const;
const CACHE_MS = 5_000;

export interface SettingsRow {
  storeName: string | null;
  supportEmail: string | null;
  approvalThresholdMinor: number | null;
  humanReviewOverMinor: number | null;
  minConfidence: number | null;
  autoAnalyse?: boolean | null;
  updatedAt: Date;
}

export interface SettingsEnv {
  MERCHANT_NAME?: string;
  APPROVAL_THRESHOLD: string;
}

/** Stored values over environment defaults. Pure, so it is tested without a database. */
export function resolveSettings(row: SettingsRow | undefined, env: SettingsEnv): StoreSettings {
  return {
    store_name: row?.storeName ?? env.MERCHANT_NAME ?? null,
    support_email: row?.supportEmail ?? null,
    approval_threshold: row?.approvalThresholdMinor != null ? fromMinor(row.approvalThresholdMinor) : env.APPROVAL_THRESHOLD,
    human_review_over: row?.humanReviewOverMinor != null ? fromMinor(row.humanReviewOverMinor) : DEFAULTS.humanReviewOver,
    min_confidence: row?.minConfidence ?? DEFAULTS.minConfidence,
    auto_analyse: row?.autoAnalyse ?? DEFAULTS.autoAnalyse,
    updated_at: row ? row.updatedAt.toISOString() : null,
  };
}

/** The columns a PATCH changes. Only keys present in the patch are written; null clears a text field. */
export function patchToColumns(patch: UpdateStoreSettingsRequest): Partial<Omit<SettingsRow, 'updatedAt'>> {
  const out: Partial<Omit<SettingsRow, 'updatedAt'>> = {};
  if ('store_name' in patch) out.storeName = patch.store_name?.trim() || null;
  if ('support_email' in patch) out.supportEmail = patch.support_email?.trim() || null;
  if (patch.approval_threshold !== undefined) out.approvalThresholdMinor = toMinor(patch.approval_threshold);
  if (patch.human_review_over !== undefined) out.humanReviewOverMinor = toMinor(patch.human_review_over);
  if (patch.min_confidence !== undefined) out.minConfidence = patch.min_confidence;
  if (patch.auto_analyse !== undefined) out.autoAnalyse = patch.auto_analyse;
  return out;
}

let cached: { at: number; value: StoreSettings } | undefined;

async function env(): Promise<SettingsEnv> {
  const { getConfig } = await import('./config');
  const c = getConfig();
  return { MERCHANT_NAME: c.MERCHANT_NAME, APPROVAL_THRESHOLD: c.APPROVAL_THRESHOLD };
}

export async function getSettings(): Promise<StoreSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const [{ eq }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../db/client')]);
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.id, 'store')).limit(1);
  const value = resolveSettings(row, await env());
  cached = { at: Date.now(), value };
  return value;
}

export async function updateSettings(patch: UpdateStoreSettingsRequest): Promise<StoreSettings> {
  const { db, schema } = await import('../db/client');
  const cols = patchToColumns(patch);
  const now = new Date();
  await db
    .insert(schema.settings)
    .values({ id: 'store', ...cols, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.id, set: { ...cols, updatedAt: now } });
  cached = undefined;
  return getSettings();
}
