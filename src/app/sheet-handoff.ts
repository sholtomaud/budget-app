/**
 * Budget sheets chosen on the Import screen, waiting for the Budget screen to
 * open them in its wizard. Held in memory only, for the one navigation.
 */
let pending: File[] = [];

export function handOffSheets(files: File[]): void {
  pending.push(...files);
}

export function takeSheets(): File[] {
  const out = pending;
  pending = [];
  return out;
}
