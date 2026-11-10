// A tiny signal between pages and the app frame: "something that the sidebar counts has changed". The frame listens
// and re-reads its counts, so a badge never lingers after the thing it counted was handled.
export const CHANGED = 'mandatepay:changed';

export function notifyChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}
