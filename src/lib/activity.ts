import { useSyncExternalStore } from "react";

/**
 * Tracks whether a conversion is running, so the app never reloads itself (for example to apply an update)
 * in the middle of one. Each source (single file, batch, merge) sets its own flag.
 */
const busy = new Set<string>();
const listeners = new Set<() => void>();

export function setBusy(source: string, on: boolean) {
  const had = busy.has(source);
  if (on) busy.add(source);
  else busy.delete(source);
  if (had !== on) listeners.forEach((l) => l());
}

export const isBusy = () => busy.size > 0;

export function subscribeBusy(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useBusy(): boolean {
  return useSyncExternalStore(subscribeBusy, isBusy, () => false);
}
