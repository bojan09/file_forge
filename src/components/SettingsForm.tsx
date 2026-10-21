"use client";

import { useState, type ReactNode } from "react";
import { PROCESSING_LIMITS } from "@/engine/registry";
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
        <Radio label="Orientation" name="orientation" value={s.orientation} options={[{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} />
        <div className="space-y-1.5">
          <label htmlFor="f-suffix" className="block text-xs font-semibold text-muted">
            Filename suffix (added before the extension)
          </label>
          <input id="f-suffix" className="field" value={s.suffix} maxLength={30} placeholder="e.g. _converted" onChange={(e) => updateSettings({ suffix: e.target.value })} />
        </div>
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
      </Card>

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
