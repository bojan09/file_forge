import type { ConversionOutput } from "../convert";
import type { OutputFormat, PageSettings, SourceKind, Stage } from "../types";

export type ItemStatus = "queued" | "converting" | "done" | "failed" | "cancelled" | "rejected";

/** Per-file settings that override the batch-wide ones. Only keys relevant to the file's conversion are used. */
export interface ItemOverrides {
  output?: OutputFormat;
  pageSize?: PageSettings["pageSize"];
  orientation?: PageSettings["orientation"];
  margins?: PageSettings["margins"];
  imageQuality?: PageSettings["imageQuality"];
  imageFit?: PageSettings["imageFit"];
}

export interface QueueItem {
  id: string;
  file: File;
  name: string;
  sizeBytes: number;
  kind: SourceKind | null;
  extension: string;
  status: ItemStatus;
  stage?: Stage;
  /** Why the file was refused at intake (status "rejected"). */
  rejectReason?: string;
  error?: string;
  errorRetryable?: boolean;
  overrides: ItemOverrides;
  attempts: number;
  output?: ConversionOutput;
}

export interface SharedSettings {
  output: OutputFormat;
  page: PageSettings;
  suffix: string;
}

export type RunState = "idle" | "running" | "pausing" | "paused" | "finished";

export interface BatchLimits {
  maxFiles: number;
  maxTotalBytes: number;
}

export interface BatchSnapshot {
  items: QueueItem[];
  shared: SharedSettings;
  run: RunState;
  limits: BatchLimits;
  /** Latest message for screen readers; `announceSeq` changes even when the text repeats. */
  announcement: string;
  announceSeq: number;
  /** Dismissible intake messages (duplicates skipped, limits reached). */
  notices: string[];
}

export interface AddReport {
  added: number;
  rejected: { name: string; reason: string }[];
  duplicates: { name: string; of: string }[];
}

export interface ConvertContext {
  output: OutputFormat;
  settings: PageSettings;
  suffix: string;
  signal: AbortSignal;
  onStage: (s: Stage) => void;
}

export interface BatchDeps {
  convert: (item: QueueItem, ctx: ConvertContext) => Promise<ConversionOutput>;
  /** Content fingerprint used only to confirm that same-size files are true duplicates. */
  fingerprint?: (file: File) => Promise<string>;
}
