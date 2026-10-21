"use client";

import type { HomeMode } from "@/lib/batch";
import { AlertIcon, BoltIcon, DeviceIcon, InfoIcon, ShieldIcon } from "./icons";
import { ModeSwitch } from "./ModeSwitch";
import { FormatList } from "./FormatList";
import { HeroIllustration } from "./HeroIllustration";
import { UploadZone, useFilePicker } from "./UploadZone";

const ASSURANCES = [
  { icon: ShieldIcon, title: "Private by design", text: "No uploads, no accounts" },
  { icon: BoltIcon, title: "Fast, no upload wait", text: "Runs on your device" },
  { icon: DeviceIcon, title: "Any modern browser", text: "Desktop, tablet, mobile" },
];

export function HomeView({ onFiles, error, notice, mode = "convert", onMode }: { onFiles: (files: File[]) => void; error?: string | null; notice?: string | null; mode?: HomeMode; onMode?: (m: HomeMode) => void }) {
  const { inputRef, pick, onChange } = useFilePicker(onFiles);
  return (
    <div className="enter">
      <div className="grid items-start gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        <section aria-labelledby="hero-title" className="space-y-5">
          <p className="badge badge-success w-fit">
            <ShieldIcon size={13} /> Processed on your device
            <span className="hidden font-normal text-muted xs:inline">· files never uploaded</span>
          </p>
          <h1 id="hero-title" className="text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            Convert your files to PDF or Word, <span className="text-gradient">privately.</span>
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted">
            Turn text, documents and images into high-quality PDF or editable Word files, all in your browser, for free.
          </p>
          {error && (
            <div role="alert" data-testid="inspect-error" className="flex gap-3 rounded-xl border border-danger/50 bg-danger/10 p-3.5 text-sm">
              <AlertIcon size={20} className="mt-0.5 shrink-0 text-danger" />
              <div>
                <p className="font-semibold">That file can&apos;t be converted</p>
                <p className="mt-0.5 text-muted">{error}</p>
              </div>
            </div>
          )}
          {notice && !error && (
            <div role="status" className="flex gap-3 rounded-xl border border-info/40 bg-info/10 p-3 text-sm">
              <InfoIcon size={18} className="mt-0.5 shrink-0 text-info" />
              <p>{notice}</p>
            </div>
          )}
          {onMode && <ModeSwitch mode={mode} onChange={onMode} />}
          <UploadZone onFiles={onFiles} mode={mode} accept={mode === "merge" ? ".jpg,.jpeg,.png,.webp" : undefined} />
        </section>

        <section aria-label="Supported conversions" className="card p-4 sm:p-5">
          <div className="mx-auto max-w-sm">
            <HeroIllustration />
          </div>
          <FormatList onPick={pick} />
          <input ref={inputRef} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onChange} data-testid="format-input" />
        </section>
      </div>

      <ul className="mt-8 grid gap-3 sm:grid-cols-3">
        {ASSURANCES.map(({ icon: Icon, title, text }) => (
          <li key={title} className="card flex items-center gap-3.5 p-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-accent-text">
              <Icon size={22} />
            </span>
            <span>
              <span className="block text-sm font-semibold">{title}</span>
              <span className="block text-xs text-muted">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
