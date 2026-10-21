"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { inspectFile, reparseInspection, runConversion, type ConversionOutput, type Inspection } from "@/engine/convert";
import { FileForgeError, type OutputFormat, type PageSettings, type ParseOptions, type Stage, type StyleSettings } from "@/engine/types";
import { getSettings, parseOptionsFromSettings, styleFromSettings } from "./settings";

export type ConverterState =
  | { phase: "idle" }
  | { phase: "inspecting"; fileName: string; step: "reading" | "parsing" }
  | { phase: "ready"; inspection: Inspection; output: OutputFormat; page: PageSettings; reparsing?: boolean }
  | { phase: "converting"; inspection: Inspection; output: OutputFormat; page: PageSettings; stage: Stage }
  | { phase: "done"; inspection: Inspection; output: OutputFormat; page: PageSettings; result: ConversionOutput; url: string }
  | { phase: "error"; origin: "inspect" | "convert"; message: string; retryable: boolean; fileName: string; inspection?: Inspection; output?: OutputFormat; page?: PageSettings };

export interface ConverterApi {
  state: ConverterState;
  /** Set when more than one file was supplied; batch conversion is deferred to Phase 2. */
  notice: string | null;
  selectFile: (file: File, extraFiles?: number) => void;
  setOutput: (o: OutputFormat) => void;
  setPage: (patch: Partial<PageSettings>) => void;
  setStyle: (patch: Partial<StyleSettings>) => void;
  /** Re-parses the loaded file with new options (CSV delimiter/header, Markdown mode) without re-reading it. */
  setParseOptions: (patch: Partial<ParseOptions>) => void;
  convert: () => void;
  cancel: () => void;
  reset: () => void;
  backToSettings: () => void;
}

const Ctx = createContext<ConverterApi | null>(null);

export function useConverter(): ConverterApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConverter must be used inside ConverterProvider");
  return v;
}

function describe(e: unknown): { message: string; retryable: boolean } {
  if (e instanceof FileForgeError) return { message: e.message, retryable: e.retryable };
  const detail = e instanceof Error && e.message ? ` (${e.message})` : "";
  return { message: `Something went wrong while processing this file.${detail}`, retryable: true };
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function ConverterProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<ConverterState>({ phase: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const stateRef = useRef<ConverterState>(state);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runId = useRef(0);

  const set = useCallback((s: ConverterState) => {
    stateRef.current = s;
    setStateRaw(s);
  }, []);

  const revoke = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runId.current++;
  }, []);

  const reset = useCallback(() => {
    stop();
    revoke();
    setNotice(null);
    set({ phase: "idle" });
  }, [stop, revoke, set]);

  const selectFile = useCallback(
    async (file: File, extraFiles = 0) => {
      stop();
      revoke();
      const id = runId.current;
      // Cancelling (or picking another file) aborts a long PDF parse and releases the pdf.js document.
      const ac = new AbortController();
      abortRef.current = ac;
      setNotice(extraFiles > 0 ? "Batch conversion isn't available yet. Only the first file was used." : null);
      set({ phase: "inspecting", fileName: file.name, step: "reading" });
      const prefs = getSettings();
      try {
        const insp = await inspectFile(
          file,
          prefs.processing,
          (step) => {
            if (id === runId.current && stateRef.current.phase === "inspecting") set({ phase: "inspecting", fileName: file.name, step });
          },
          parseOptionsFromSettings(prefs),
          ac.signal,
        );
        if (id !== runId.current) return;
        const outputs = insp.format.outputs;
        const output = outputs.includes(prefs.defaultOutput) ? prefs.defaultOutput : outputs[0]!;
        set({
          phase: "ready",
          inspection: insp,
          output,
          // Binary sources (DOCX, XLSX, PDF) carry their own page setup, fonts and header/footer: use them as editable starting points.
          page: {
            pageSize: insp.suggested?.page?.pageSize ?? prefs.pageSize,
            orientation: insp.kind === "image" ? "auto" : (insp.suggested?.page?.orientation ?? prefs.orientation),
            margins: insp.suggested?.page?.margins ?? prefs.margins,
            imageQuality: prefs.imageQuality,
            imageFit: prefs.imageFit,
            style: { ...styleFromSettings(prefs), ...insp.suggested?.style },
          },
        });
      } catch (e) {
        if (id !== runId.current) return;
        const d = describe(e);
        set({ phase: "error", origin: "inspect", message: d.message, retryable: false, fileName: file.name });
      }
    },
    [stop, revoke, set],
  );

  const setOutput = useCallback(
    (output: OutputFormat) => {
      const s = stateRef.current;
      if (s.phase === "ready" && s.inspection.format.outputs.includes(output)) set({ ...s, output });
    },
    [set],
  );

  const setPage = useCallback(
    (patch: Partial<PageSettings>) => {
      const s = stateRef.current;
      if (s.phase === "ready") set({ ...s, page: { ...s.page, ...patch } });
    },
    [set],
  );

  const setStyle = useCallback(
    (patch: Partial<StyleSettings>) => {
      const s = stateRef.current;
      if (s.phase === "ready") set({ ...s, page: { ...s.page, style: { ...s.page.style, ...patch } } });
    },
    [set],
  );

  const setParseOptions = useCallback(
    async (patch: Partial<ParseOptions>) => {
      const s = stateRef.current;
      if (s.phase !== "ready" || s.reparsing) return;
      const id = runId.current;
      const options = { ...s.inspection.options, ...patch };
      set({ ...s, reparsing: true });
      try {
        const inspection = await reparseInspection(s.inspection, getSettings().processing, options);
        const cur = stateRef.current;
        if (id !== runId.current || cur.phase !== "ready") return;
        set({ ...cur, inspection, reparsing: false });
      } catch (e) {
        const cur = stateRef.current;
        if (id !== runId.current || cur.phase !== "ready") return;
        const d = describe(e);
        set({ ...cur, reparsing: false });
        setNotice(d.message);
      }
    },
    [set],
  );

  const convert = useCallback(async () => {
    const s = stateRef.current;
    if (s.phase !== "ready") return;
    stop();
    const id = runId.current;
    const ac = new AbortController();
    abortRef.current = ac;
    const { inspection, output, page } = s;
    set({ phase: "converting", inspection, output, page, stage: "reading" });
    try {
      const result = await runConversion(inspection, {
        output,
        settings: page,
        suffix: getSettings().suffix,
        signal: ac.signal,
        onStage: (stage) => {
          if (id === runId.current) set({ phase: "converting", inspection, output, page, stage });
        },
      });
      if (id !== runId.current) return;
      revoke();
      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      set({ phase: "done", inspection, output, page, result, url });
    } catch (e) {
      if (id !== runId.current) return;
      if (isAbort(e)) {
        set({ phase: "ready", inspection, output, page });
        return;
      }
      const d = describe(e);
      set({ phase: "error", origin: "convert", message: d.message, retryable: d.retryable, fileName: inspection.name, inspection, output, page });
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [stop, revoke, set]);

  const cancel = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== "converting") return;
    stop();
    set({ phase: "ready", inspection: s.inspection, output: s.output, page: s.page });
  }, [stop, set]);

  const backToSettings = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === "done" || (s.phase === "error" && s.inspection && s.output && s.page)) {
      revoke();
      set({ phase: "ready", inspection: s.inspection!, output: s.output!, page: s.page! });
    }
  }, [revoke, set]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const api = useMemo<ConverterApi>(
    () => ({ state, notice, selectFile, setOutput, setPage, setStyle, setParseOptions, convert, cancel, reset, backToSettings }),
    [state, notice, selectFile, setOutput, setPage, setStyle, setParseOptions, convert, cancel, reset, backToSettings],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
