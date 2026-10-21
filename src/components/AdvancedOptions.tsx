"use client";

import { useId, type ReactNode } from "react";
import { FONT_SIZE_RANGE, MAX_HEADER_FOOTER_CHARS, resolveStyle } from "@/engine/style";
import type { Inspection } from "@/engine/convert";
import type { OutputFormat, PageSettings, ParseOptions, StyleSettings } from "@/engine/types";
import { useConverter } from "@/lib/converter";

function Row({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="text-[0.7rem] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="choice !min-h-10 justify-center !px-2 text-sm font-medium" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
      <input id={id} type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const SPACING = [1, 1.15, 1.3, 1.5, 2];

/**
 * Typography, header/footer and table options. Only controls that apply to the loaded file are shown:
 * CSV options for CSV, Markdown mode for Markdown, table styling when the document has a table.
 * Collapsed by default so the common path (pick a format, convert) stays short.
 */
export function AdvancedOptions({ insp, output, page }: { insp: Inspection; output: OutputFormat; page: PageSettings }) {
  const { setStyle, setParseOptions, state } = useConverter();
  const uid = useId();
  const style = resolveStyle(page.style);
  const busy = state.phase === "ready" && !!state.reparsing;
  const opts = insp.options;
  const isCsv = insp.kind === "csv";
  const isMd = insp.kind === "md";
  const hasTables = !!insp.doc?.hasTables;
  const s = (patch: Partial<StyleSettings>) => setStyle(patch);
  const p = (patch: Partial<ParseOptions>) => setParseOptions(patch);
  const id = (k: string) => `${uid}-${k}`;

  return (
    <details className="group space-y-4 border-t border-line pt-4" data-testid="advanced-options" aria-busy={busy}>
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-sm font-bold [&::-webkit-details-marker]:hidden">
        <span>Advanced options</span>
        <span className="text-xs font-medium text-muted group-open:hidden">Fonts, headers, tables</span>
      </summary>

      <div className="space-y-4 pt-3">
        {isMd && (
          <Row label="Markdown output">
            <Seg
              label="Markdown output"
              value={opts.markdown}
              onChange={(v) => p({ markdown: v })}
              options={[
                { value: "formatted", label: "Formatted" },
                { value: "source", label: "Source text" },
              ]}
            />
          </Row>
        )}

        {isCsv && (
          <>
            <Row label="Delimiter" htmlFor={id("delim")} hint="Auto-detect works for most files. Override it if columns look merged.">
              <select id={id("delim")} className="field" value={opts.csvDelimiter} onChange={(e) => p({ csvDelimiter: e.target.value as ParseOptions["csvDelimiter"] })}>
                <option value="auto">Auto-detect</option>
                <option value=",">Comma ( , )</option>
                <option value=";">Semicolon ( ; )</option>
                <option value={"\t"}>Tab</option>
                <option value="|">Pipe ( | )</option>
              </select>
            </Row>
            <Row label="First row">
              <Seg
                label="First row"
                value={opts.csvHeader}
                onChange={(v) => p({ csvHeader: v })}
                options={[
                  { value: "first", label: "Is the header" },
                  { value: "none", label: "Is data" },
                ]}
              />
            </Row>
          </>
        )}

        <Row label="Font" hint={output === "docx" ? "Word uses Calibri, Times New Roman or Courier New; if a font is missing on your device Word substitutes a similar one." : "Fonts are embedded in the PDF."}>
          <Seg
            label="Font"
            value={style.fontFamily}
            onChange={(v) => s({ fontFamily: v })}
            options={[
              { value: "sans", label: "Sans" },
              { value: "serif", label: "Serif" },
              { value: "mono", label: "Mono" },
            ]}
          />
        </Row>

        <div className="grid grid-cols-2 gap-3">
          <Row label={`Font size: ${style.fontSize} pt`} htmlFor={id("size")}>
            <input id={id("size")} type="range" className="w-full accent-[var(--accent)]" min={FONT_SIZE_RANGE.min} max={FONT_SIZE_RANGE.max} step={1} value={style.fontSize} onChange={(e) => s({ fontSize: Number(e.target.value) })} aria-valuetext={`${style.fontSize} points`} />
          </Row>
          <Row label="Line spacing" htmlFor={id("spacing")}>
            <select id={id("spacing")} className="field" value={String(SPACING.includes(style.lineSpacing) ? style.lineSpacing : 1.3)} onChange={(e) => s({ lineSpacing: Number(e.target.value) })}>
              {SPACING.map((v) => (
                <option key={v} value={v}>
                  {v === 1.3 ? "1.3 (default)" : v.toFixed(v % 1 ? 2 : 1).replace(/0$/, "")}
                </option>
              ))}
            </select>
          </Row>
        </div>

        <Row label="Page numbers" htmlFor={id("pn")}>
          <select id={id("pn")} className="field" value={style.pageNumbers} onChange={(e) => s({ pageNumbers: e.target.value as StyleSettings["pageNumbers"] })}>
            <option value="none">None</option>
            <option value="n">1</option>
            <option value="n-of-N">1 / 5</option>
            <option value="page-n-of-N">Page 1 of 5</option>
          </select>
        </Row>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <Row label="Header text" htmlFor={id("head")}>
            <input id={id("head")} className="field" type="text" maxLength={MAX_HEADER_FOOTER_CHARS} placeholder="Optional" value={style.headerText} onChange={(e) => s({ headerText: e.target.value })} />
          </Row>
          <Row label="Footer text" htmlFor={id("foot")}>
            <input id={id("foot")} className="field" type="text" maxLength={MAX_HEADER_FOOTER_CHARS} placeholder="Optional" value={style.footerText} onChange={(e) => s({ footerText: e.target.value })} />
          </Row>
        </div>

        {hasTables && (
          <fieldset className="space-y-3 rounded-xl border border-line p-3">
            <legend className="px-1 text-xs font-bold">Tables</legend>
            <Row label="Borders" htmlFor={id("borders")}>
              <select id={id("borders")} className="field" value={style.tableBorders} onChange={(e) => s({ tableBorders: e.target.value as StyleSettings["tableBorders"] })}>
                <option value="grid">Full grid</option>
                <option value="horizontal">Horizontal lines</option>
                <option value="none">None</option>
              </select>
            </Row>
            <Check id={id("zebra")} label="Alternate row shading" checked={style.tableZebra} onChange={(v) => s({ tableZebra: v })} />
            <Check id={id("hfill")} label="Shade the header row" checked={style.tableHeaderFill} onChange={(v) => s({ tableHeaderFill: v })} />
            <Row label="Column widths">
              <Seg
                label="Column widths"
                value={style.columnSizing}
                onChange={(v) => s({ columnSizing: v })}
                options={[
                  { value: "content", label: "Fit content" },
                  { value: "equal", label: "Equal" },
                ]}
              />
            </Row>
            <Check id={id("nums")} label="Right-align numbers (CSV, HTML)" checked={style.numberAlign === "auto"} onChange={(v) => s({ numberAlign: v ? "auto" : "left" })} />
            <Row label={`Table text size: ${Math.round(style.tableFontScale * 100)}%`} htmlFor={id("tscale")}>
              <input id={id("tscale")} type="range" className="w-full accent-[var(--accent)]" min={80} max={140} step={10} value={Math.round(style.tableFontScale * 100)} onChange={(e) => s({ tableFontScale: Number(e.target.value) / 100 })} aria-valuetext={`${Math.round(style.tableFontScale * 100)} percent`} />
            </Row>
          </fieldset>
        )}
      </div>
    </details>
  );
}
