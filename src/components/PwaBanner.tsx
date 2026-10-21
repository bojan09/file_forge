"use client";

import { useBusy } from "@/lib/activity";
import { usePwa } from "@/lib/pwa";
import { RefreshIcon } from "./icons";

/**
 * Two small, non-blocking notices: the app is offline (conversions still work), and a new version is ready.
 * Updating never happens by itself; it waits for the user and for any running conversion.
 */
export function PwaBanner() {
  const { online, updateReady, applyUpdate } = usePwa();
  const busy = useBusy();
  if (online && !updateReady) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex flex-col items-center gap-2 px-3 md:bottom-4" data-testid="pwa-banner">
      {!online && (
        <p role="status" className="pointer-events-auto rounded-full border border-line bg-surface px-4 py-2 text-xs font-medium shadow-lg" data-testid="offline-pill">
          You&apos;re offline. Conversions still work; nothing is uploaded.
        </p>
      )}
      {updateReady && (
        <div role="status" className="pointer-events-auto flex max-w-md flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm shadow-lg" data-testid="update-banner">
          <span className="min-w-0 flex-1">
            {busy ? "A new version is ready. You can update when the current conversion finishes." : "A new version of FileForge is ready. Updating reloads the page, which clears the current file and result, so download first."}
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={applyUpdate} disabled={busy} data-testid="update-now">
            <RefreshIcon size={15} /> {busy ? "Update after conversion" : "Update now"}
          </button>
        </div>
      )}
    </div>
  );
}
