"use client";

import { updateSettings } from "@/lib/settings";
import { useResolvedTheme } from "@/lib/theme";
import { MoonIcon, SunIcon } from "./icons";

export function ThemeToggle() {
  const resolved = useResolvedTheme();
  const base = "grid place-items-center size-9 rounded-lg border transition-colors";
  const on = "border-accent bg-accent/15 text-accent-text";
  const off = "border-transparent text-muted hover:text-fg hover:bg-surface-2";
  return (
    <div role="group" aria-label="Color theme" className="flex items-center gap-1">
      <button type="button" className={`${base} ${resolved === "light" ? on : off}`} aria-pressed={resolved === "light"} aria-label="Light theme" onClick={() => updateSettings({ theme: "light" })}>
        <SunIcon size={18} />
      </button>
      <button type="button" className={`${base} ${resolved === "dark" ? on : off}`} aria-pressed={resolved === "dark"} aria-label="Dark theme" onClick={() => updateSettings({ theme: "dark" })}>
        <MoonIcon size={18} />
      </button>
    </div>
  );
}
