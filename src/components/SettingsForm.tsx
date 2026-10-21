"use client";

import { useState, type ReactNode } from "react";
import { BATCH_LIMITS } from "@/engine/batch/limits";
import { PROCESSING_LIMITS } from "@/engine/registry";
import { clearOfflineData, usePwa } from "@/lib/pwa";
import { resetSettings, updateSettings, useSettings, type AccentName, type Settings } from "@/lib/settings";
import { TrashIcon } from "./icons";

const ACCENTS: { id: AccentName; label: string; color: string }[] = [
  { id: "indigo", label: "Indigo", color: "#6366f1" },
  { id: "cyan", label: "Cyan", color: "#22d3ee" },
  { id: "emerald", label: "Emerald", color: "#10b981" },
  { id: "violet", label: "Violet", color: "#8b5cf6" },
];

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Radio<K extends keyof Settings>({ label, name, value, options }: { label: string; name: K; value: Settings[K]; options: { value: Settings[K]; label: string }[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted" id={`s-${name}`}>
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={`s-${name}`} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} className="choice !min-h-11 justify-center !px-2 text-sm font-medium" onClick={() => updateSettings({ [name]: o.value } as Partial<Settings>)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Select<K extends keyof Settings>({ label, name, value, options }: { label: string; name: K; value: Settings[K]; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`f-${name}`} className="block text-xs font-semibold text-muted">
        {label}
      </label>
      <select id={`f-${name}`} className="field" value={String(value)} onChange={(e) => updateSettings({ [name]: e.target.value } as Partial<Settings>)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumSelect({ label, name, value, options }: { label: string; name: "fontSize" | "lineSpacing"; value: number; options: { value: number; label: string }[] }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`f-${name}`} className="block text-xs font-semibold text-muted">
        {label}
      </label>
      <select id={`f-${name}`} className="field" value={String(value)} onChange={(e) => updateSettings({ [name]: Number(e.target.value) })}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Toggle({ id, label, name, checked }: { id: string; label: string; name: "tableZebra" | "tableHeaderFill"; checked: boolean }) {
  return (
    <label htmlFor={id} className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
      <input id={id} type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked} onChange={(e) => updateSettings({ [name]: e.target.checked })} />
      {label}
    </label>
  );
}

function OfflineCard() {
  const { offline, progress, online, canInstall, installed, install } = usePwa();
  const [cleared, setCleared] = useState(false);
  const status =
    offline === "ready"
      ? "Ready. After this first visit every conversion engine, font and page is stored on this device, so FileForge works without a connection."
      : offline === "caching"
        ? `Preparing offline use: ${progress ? `${progress.done} of ${progress.total} files stored` : "downloading"}. Stay on this page until it finishes.`
        : offline === "data-saver"
          ? "Offline use is off because your device asked to save data (the offline copy is about 8 MB). Turn off Data Saver and reload to enable it."
          : offline === "unsupported"
          ? "Offline use isn't available here (the browser blocks service workers, or this is a development build). Everything else works while you're online."
          : "Checking…";
  return (
    <Card title="Offline use and install">
      <p className="text-sm leading-relaxed text-muted" role="status" data-testid="offline-status" data-state={offline}>
        {status}
      </p>
      <p className="text-sm leading-relaxed text-muted">
        Only the app itself is stored (pages, scripts, fonts, icons). Your files, results and previews are never cached; they stay in memory and disappear when you close or reset the page. {online ? "" : "You are offline right now."}
      </p>
      <div className="flex flex-wrap gap-3">
        {canInstall && (
          <button type="button" className="btn btn-primary" onClick={() => void install()} data-testid="install-app">
            Install FileForge
          </button>
        )}
        {installed && <span className="badge badge-success">Installed</span>}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            void clearOfflineData().then(() => setCleared(true));
          }}
          data-testid="clear-offline"
        >
          <TrashIcon size={17} /> Remove offline copy
        </button>
      </div>
      {!canInstall && !installed && (
        <p className="text-sm leading-relaxed text-muted">To install: in Chrome or Edge use the install icon in the address bar; in Safari on iPhone or iPad choose Share, then Add to Home Screen.</p>
      )}
      <p role="status" className="text-sm text-success">
        {cleared ? "Offline copy removed. Reload the page to download it again." : ""}
      </p>
    </Card>
  );
}

export function SettingsForm() {
  const s = useSettings();
  const [cleared, setCleared] = useState(false);
  return (
    <div className="space-y-5">
      <Card title="Appearance">
        <Radio label="Theme" name="theme" value={s.theme} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted" id="s-accent">
            Accent color
          </p>
          <div role="radiogroup" aria-labelledby="s-accent" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ACCENTS.map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={s.accent === a.id} className="choice !min-h-11 justify-center text-sm font-medium" onClick={() => updateSettings({ accent: a.id })}>
                <span aria-hidden="true" className="size-4 rounded-full" style={{ background: a.color }} />
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <Radio label="Motion" name="motion" value={s.motion} options={[{ value: "system", label: "System" }, { value: "full", label: "Full" }, { value: "reduced", label: "Reduced" }]} />
      </Card>

      <Card title="Conversion defaults">
        <Radio label="Default output" name="defaultOutput" value={s.defaultOutput} options={[{ value: "pdf", label: "PDF" }, { value: "docx", label: "DOCX" }]} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Page size" name="pageSize" value={s.pageSize} options={[{ value: "A4", label: "A4" }, { value: "LETTER", label: "Letter" }, { value: "LEGAL", label: "Legal" }]} />
          <Select label="Margins" name="margins" value={s.margins} options={[{ value: "narrow", label: "Narrow" }, { value: "normal", label: "Normal" }, { value: "wide", label: "Wide" }]} />
        </div>
        <Radio label="Orientation" name="orientation" value={s.orientation} options={[{ value: "auto", label: "Auto" }, { value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} />
        <div className="space-y-1.5">
          <label htmlFor="f-suffix" className="block text-xs font-semibold text-muted">
            Filename suffix (added before the extension)
          </label>
          <input id="f-suffix" className="field" value={s.suffix} maxLength={30} placeholder="e.g. _converted" onChange={(e) => updateSettings({ suffix: e.target.value })} />
        </div>
      </Card>

      <Card title="Document style">
        <p className="text-sm text-muted">Applies to text, Markdown, HTML and CSV conversions. You can still change these for a single file under Advanced options.</p>
        <Radio label="Font" name="fontFamily" value={s.fontFamily} options={[{ value: "sans", label: "Sans" }, { value: "serif", label: "Serif" }, { value: "mono", label: "Mono" }]} />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumSelect label="Font size" name="fontSize" value={s.fontSize} options={[9, 10, 11, 12, 13, 14, 16].map((v) => ({ value: v, label: `${v} pt${v === 11 ? " (default)" : ""}` }))} />
          <NumSelect label="Line spacing" name="lineSpacing" value={s.lineSpacing} options={[1, 1.15, 1.3, 1.5, 2].map((v) => ({ value: v, label: v === 1.3 ? "1.3 (default)" : String(v) }))} />
        </div>
        <Select label="Page numbers" name="pageNumbers" value={s.pageNumbers} options={[{ value: "none", label: "None" }, { value: "n", label: "1" }, { value: "n-of-N", label: "1 / 5" }, { value: "page-n-of-N", label: "Page 1 of 5" }]} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Table borders" name="tableBorders" value={s.tableBorders} options={[{ value: "grid", label: "Full grid" }, { value: "horizontal", label: "Horizontal lines" }, { value: "none", label: "None" }]} />
          <Select label="Column widths" name="columnSizing" value={s.columnSizing} options={[{ value: "content", label: "Fit content" }, { value: "equal", label: "Equal" }]} />
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          <Toggle id="f-zebra" label="Alternate row shading" name="tableZebra" checked={s.tableZebra} />
          <Toggle id="f-hfill" label="Shade the table header row" name="tableHeaderFill" checked={s.tableHeaderFill} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="CSV delimiter" name="csvDelimiter" value={s.csvDelimiter} options={[{ value: "auto", label: "Auto-detect" }, { value: ",", label: "Comma" }, { value: ";", label: "Semicolon" }, { value: "\t", label: "Tab" }, { value: "|", label: "Pipe" }]} />
          <Select label="CSV first row" name="csvHeader" value={s.csvHeader} options={[{ value: "first", label: "Is the header" }, { value: "none", label: "Is data" }]} />
        </div>
        <Radio label="Markdown output" name="markdown" value={s.markdown} options={[{ value: "formatted", label: "Formatted" }, { value: "source", label: "Source text" }]} />
      </Card>

      <Card title="Images">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Image quality" name="imageQuality" value={s.imageQuality} options={[{ value: "high", label: "High (original pixels)" }, { value: "balanced", label: "Balanced (max 3000 px)" }, { value: "small", label: "Small file (max 2000 px)" }]} />
          <Select label="Image fit" name="imageFit" value={s.imageFit} options={[{ value: "fit", label: "Fit to page" }, { value: "match", label: "Match image size" }]} />
        </div>
      </Card>

      <Card title="Processing">
        <Radio label="Mode" name="processing" value={s.processing} options={[{ value: "balanced", label: "Balanced" }, { value: "conservative", label: "Conservative" }]} />
        <p className="text-sm leading-relaxed text-muted">
          Balanced allows up to {PROCESSING_LIMITS.balanced.imageMaxMegapixels} MP images, {PROCESSING_LIMITS.balanced.csvMaxRows.toLocaleString()} CSV rows and {PROCESSING_LIMITS.balanced.csvMaxCols} columns. Conservative lowers those to {PROCESSING_LIMITS.conservative.imageMaxMegapixels} MP, {PROCESSING_LIMITS.conservative.csvMaxRows.toLocaleString()} rows and {PROCESSING_LIMITS.conservative.csvMaxCols} columns (and caps HTML complexity) to protect low-memory devices.
        </p>
        <p className="text-sm leading-relaxed text-muted" data-testid="batch-limits-copy">
          Batch limits: balanced allows {BATCH_LIMITS.balanced.maxFiles} files and {BATCH_LIMITS.balanced.maxTotalBytes / 1048576} MB combined per batch; conservative allows {BATCH_LIMITS.conservative.maxFiles} files and {BATCH_LIMITS.conservative.maxTotalBytes / 1048576} MB. Files always convert one at a time. On devices that report 2 GB of memory or less, balanced uses the conservative batch limits automatically.
        </p>
      </Card>

      <OfflineCard />

      <Card title="Stored data">
        <p className="text-sm text-muted">Preferences live in this browser&apos;s local storage. Files are never stored.</p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            resetSettings();
            setCleared(true);
          }}
          data-testid="clear-settings"
        >
          <TrashIcon size={17} /> Clear saved preferences
        </button>
        <p role="status" className="text-sm text-success">
          {cleared ? "Preferences cleared. Defaults restored." : ""}
        </p>
      </Card>
    </div>
  );
}
