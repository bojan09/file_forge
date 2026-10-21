import type { Processing } from "../types";
import type { BatchLimits } from "./types";

const MB = 1024 * 1024;

/** Conservative defaults. Tuned against the measurements in docs/PHASE_2_REPORT.md. */
export const BATCH_LIMITS: Record<Processing, BatchLimits> = {
  balanced: { maxFiles: 10, maxTotalBytes: 50 * MB },
  conservative: { maxFiles: 5, maxTotalBytes: 25 * MB },
};

export interface EffectiveLimits {
  limits: BatchLimits;
  /** Shown to the user when limits were lowered or memory looks tight. */
  warning?: string;
}

/**
 * Lowers limits on memory-constrained devices. `deviceMemory` (GB) comes from navigator.deviceMemory,
 * which is only available in Chromium-based browsers; when unknown the profile limits apply unchanged.
 */
export function effectiveBatchLimits(processing: Processing, deviceMemory?: number): EffectiveLimits {
  const base = BATCH_LIMITS[processing];
  if (deviceMemory !== undefined && deviceMemory <= 2 && processing === "balanced") {
    return {
      limits: BATCH_LIMITS.conservative,
      warning: `This device reports about ${deviceMemory} GB of memory, so batch limits were lowered to ${BATCH_LIMITS.conservative.maxFiles} files and ${BATCH_LIMITS.conservative.maxTotalBytes / MB} MB.`,
    };
  }
  if (deviceMemory !== undefined && deviceMemory <= 4) {
    return { limits: base, warning: `This device reports about ${deviceMemory} GB of memory. Large batches may be slow; consider converting fewer files at once.` };
  }
  return { limits: base };
}

export function currentDeviceMemory(): number | undefined {
  if (typeof navigator === "undefined") return undefined;
  const m = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof m === "number" ? m : undefined;
}
