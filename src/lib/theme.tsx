"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useSettings } from "./settings";

const QUERY = "(prefers-color-scheme: dark)";

function subscribeSystem(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const ResolvedThemeContext = createContext<"light" | "dark">("dark");

export function useResolvedTheme() {
  return useContext(ResolvedThemeContext);
}

/** Mirrors settings onto <html> data attributes. The inline script in layout.tsx sets the same attributes before first paint. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const s = useSettings();
  const systemDark = useSyncExternalStore(subscribeSystem, () => window.matchMedia(QUERY).matches, () => true);
  const resolved = s.theme === "system" ? (systemDark ? "dark" : "light") : s.theme;

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = resolved;
    el.dataset.accent = s.accent;
    el.dataset.motion = s.motion;
  }, [resolved, s.accent, s.motion]);

  return <ResolvedThemeContext.Provider value={resolved}>{children}</ResolvedThemeContext.Provider>;
}

/** Runs before first paint to avoid a flash of the wrong theme. Reads only non-sensitive preferences. */
export const THEME_INIT_SCRIPT = `(function(){var e=document.documentElement;try{var s=JSON.parse(localStorage.getItem('fileforge:settings:v1')||'{}');var t=['light','dark'].indexOf(s.theme)>-1?s.theme:'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);e.dataset.theme=d?'dark':'light';e.dataset.accent=['indigo','cyan','emerald','violet'].indexOf(s.accent)>-1?s.accent:'indigo';e.dataset.motion=['full','reduced'].indexOf(s.motion)>-1?s.motion:'system';}catch(_){e.dataset.theme=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';e.dataset.accent='indigo';e.dataset.motion='system';}})();`;
