/**
 * What each screen is showing, in a few words, for the chat panel's context
 * chip (ADR 0023). Screens set it; the panel reads it. Only already-rounded,
 * already-visible summaries go here, never raw data.
 */
import { Store } from './core/store.ts';

export const pageDetails = new Store<Record<string, string>>({});

export function setPageDetail(path: string, detail: string | null): void {
  const next = { ...pageDetails.getState() };
  if (detail) next[path] = detail;
  else delete next[path];
  pageDetails.setState(next);
}
