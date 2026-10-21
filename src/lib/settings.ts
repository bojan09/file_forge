import { useSyncExternalStore } from "react";
import { DEFAULT_PARSE_OPTIONS, DEFAULT_STYLE, resolveStyle } from "@/engine/style";
import type { ColumnSizing, FontFamilyName, ImageFit, ImageQuality, MarginName, NumberAlign, Orientation, PageNumberStyle, PageSizeName, ParseOptions, Processing, StyleSettings, TableBorders } from "@/engine/types";

export type ThemePref = "system" | "light" | "dark";
export type AccentName = "indigo" | "cyan" | "emerald" | "violet";
export type MotionPref = "system" | "full" | "reduced";

export interface Settings {
  theme: ThemePref;
  accent: AccentName;
  motion: MotionPref;
  defaultOutput: "pdf" | "docx";
  pageSize: PageSizeName;
  orientation: Orientation | "auto";
  margins: MarginName;
  imageQuality: ImageQuality;
  imageFit: ImageFit;
  suffix: string;
  processing: Processing;
  fontFamily: FontFamilyName;
  fontSize: number;
  lineSpacing: number;
  pageNumbers: PageNumberStyle;
  tableZebra: boolean;
  tableBorders: TableBorders;
  tableHeaderFill: boolean;
  columnSizing: ColumnSizing;
  numberAlign: NumberAlign;
  tableFontScale: number;
  csvDelimiter: ParseOptions["csvDelimiter"];
  csvHeader: ParseOptions["csvHeader"];
  markdown: ParseOptions["markdown"];
}

/** The persisted typography/table defaults, as the renderers' style object (header and footer text are per file). */
export function styleFromSettings(s: Settings): StyleSettings {
  return resolveStyle({ fontFamily: s.fontFamily, fontSize: s.fontSize, lineSpacing: s.lineSpacing, pageNumbers: s.pageNumbers, tableZebra: s.tableZebra, tableBorders: s.tableBorders, tableHeaderFill: s.tableHeaderFill, columnSizing: s.columnSizing, numberAlign: s.numberAlign, tableFontScale: s.tableFontScale });
}

export function parseOptionsFromSettings(s: Settings): ParseOptions {
  return { ...DEFAULT_PARSE_OPTIONS, csvDelimiter: s.csvDelimiter, csvHeader: s.csvHeader, markdown: s.markdown };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  accent: "indigo",
  motion: "system",
  defaultOutput: "pdf",
  pageSize: "A4",
  orientation: "portrait",
  margins: "normal",
  imageQuality: "balanced",
  imageFit: "fit",
  suffix: "",
  processing: "balanced",
  fontFamily: DEFAULT_STYLE.fontFamily,
  fontSize: DEFAULT_STYLE.fontSize,
  lineSpacing: DEFAULT_STYLE.lineSpacing,
  pageNumbers: DEFAULT_STYLE.pageNumbers,
  tableZebra: DEFAULT_STYLE.tableZebra,
  tableBorders: DEFAULT_STYLE.tableBorders,
  tableHeaderFill: DEFAULT_STYLE.tableHeaderFill,
  columnSizing: DEFAULT_STYLE.columnSizing,
  numberAlign: DEFAULT_STYLE.numberAlign,
  tableFontScale: DEFAULT_STYLE.tableFontScale,
  csvDelimiter: DEFAULT_PARSE_OPTIONS.csvDelimiter,
  csvHeader: DEFAULT_PARSE_OPTIONS.csvHeader,
  markdown: DEFAULT_PARSE_OPTIONS.markdown,
};

export const STORAGE_KEY = "fileforge:settings:v1";

const ALLOWED: { [K in keyof Settings]?: readonly Settings[K][] } = {
  theme: ["system", "light", "dark"],
  accent: ["indigo", "cyan", "emerald", "violet"],
  motion: ["system", "full", "reduced"],
  defaultOutput: ["pdf", "docx"],
  pageSize: ["A4", "LETTER", "LEGAL"],
  orientation: ["portrait", "landscape", "auto"],
  margins: ["narrow", "normal", "wide"],
  imageQuality: ["high", "balanced", "small"],
  imageFit: ["fit", "match"],
  processing: ["conservative", "balanced"],
  fontFamily: ["sans", "serif", "mono"],
  pageNumbers: ["none", "n", "n-of-N", "page-n-of-N"],
  tableZebra: [true, false],
  tableBorders: ["grid", "horizontal", "none"],
  tableHeaderFill: [true, false],
  columnSizing: ["content", "equal"],
  numberAlign: ["auto", "left"],
  csvDelimiter: ["auto", ",", ";", "\t", "|"],
  csvHeader: ["first", "none"],
  markdown: ["formatted", "source"],
};

/** Keeps only known keys with allowed values, so stale or tampered storage can't break the app. */
export function sanitizeSettings(input: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!input || typeof input !== "object") return out;
  const src = input as Record<string, unknown>;
  for (const key of Object.keys(ALLOWED) as (keyof Settings)[]) {
    const allowed = ALLOWED[key] as readonly unknown[];
    if (allowed.includes(src[key])) (out as unknown as Record<string, unknown>)[key] = src[key];
  }
  // Numeric typography settings are clamped rather than rejected, so a stale value degrades gracefully.
  const typo = resolveStyle({ fontSize: src.fontSize as number, lineSpacing: src.lineSpacing as number, tableFontScale: src.tableFontScale as number });
  out.fontSize = typo.fontSize;
  out.lineSpacing = typo.lineSpacing;
  out.tableFontScale = typo.tableFontScale;
  if (typeof src.suffix === "string") out.suffix = src.suffix.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").slice(0, 30);
  return out;
}

let cache: Settings | null = null;
const listeners = new Set<() => void>();

function read(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function getSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  return (cache ??= read());
}

export function updateSettings(patch: Partial<Settings>) {
  cache = sanitizeSettings({ ...getSettings(), ...patch });
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable (private mode, blocked): keep in memory for this session */
  }
  emit();
}

export function resetSettings() {
  cache = { ...DEFAULT_SETTINGS };
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      cache = read();
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, () => DEFAULT_SETTINGS);
}
