"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { isBusy } from "./activity";

export type OfflineState = "unsupported" | "data-saver" | "checking" | "caching" | "ready";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface PwaApi {
  online: boolean;
  offline: OfflineState;
  /** Files cached for offline use, while `offline` is "caching". */
  progress: { done: number; total: number } | null;
  updateReady: boolean;
  applyUpdate: () => void;
  canInstall: boolean;
  installed: boolean;
  install: () => Promise<void>;
}

const Ctx = createContext<PwaApi | null>(null);

export function usePwa(): PwaApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePwa must be used inside PwaProvider");
  return v;
}

function askStatus(sw: ServiceWorker): Promise<{ complete: boolean; total: number; cached: number } | null> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), 3000);
    ch.port1.onmessage = (e) => {
      clearTimeout(t);
      resolve(e.data);
    };
    sw.postMessage({ type: "STATUS" }, [ch.port2]);
  });
}

/** Why offline caching is not attempted here, if it isn't. Data Saver users keep their data: the ~8 MB copy is not downloaded for them. */
function blocker(): "unsupported" | "data-saver" | null {
  if (process.env.NODE_ENV !== "production" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g") return "data-saver";
  return null;
}
const noopSubscribe = () => () => {};
const onlineSubscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

const standalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

export function PwaProvider({ children }: { children: ReactNode }) {
  const online = useSyncExternalStore(onlineSubscribe, () => navigator.onLine, () => true);
  const blocked = useSyncExternalStore(noopSubscribe, blocker, () => null);
  const installed0 = useSyncExternalStore(noopSubscribe, standalone, () => false);
  const [swState, setOffline] = useState<OfflineState>("checking");
  const offline: OfflineState = blocked ?? swState;
  const [progress, setProgress] = useState<PwaApi["progress"]>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [justInstalled, setJustInstalled] = useState(false);
  const installed = installed0 || justInstalled;
  const waiting = useRef<ServiceWorker | null>(null);
  const updating = useRef(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setJustInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (blocked) return;
    let cancelled = false;
    const container = navigator.serviceWorker;

    const refreshStatus = async () => {
      const reg = await container.getRegistration("/");
      const sw = reg?.active ?? reg?.waiting ?? reg?.installing;
      if (!sw || cancelled) return;
      const s = await askStatus(sw);
      if (cancelled || !s) return;
      if (s.complete) {
        setOffline("ready");
        setProgress(null);
      } else {
        setOffline("caching");
        setProgress({ done: s.cached, total: s.total });
      }
    };

    const watch = (reg: ServiceWorkerRegistration) => {
      const consider = (w: ServiceWorker | null) => {
        if (w && container.controller) {
          waiting.current = w;
          setUpdateReady(true);
        }
      };
      consider(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed") consider(w);
          if (w.state === "activated") void refreshStatus();
        });
      });
    };

    const onMessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; done?: number; total?: number } | undefined;
      if (m?.type === "PRECACHE_PROGRESS" && m.total) {
        setOffline(m.done === m.total ? "ready" : "caching");
        setProgress(m.done === m.total ? null : { done: m.done ?? 0, total: m.total });
      } else if (m?.type === "ACTIVATED") void refreshStatus();
    };
    container.addEventListener("message", onMessage);

    // The new version takes over only after the user accepted it while nothing was converting (see applyUpdate),
    // so the old page never keeps running against a newer set of script files.
    // On the very first visit the worker also "takes control" (clients.claim); that must not reload the page under the user.
    const onControllerChange = () => {
      if (updating.current) window.location.reload();
    };
    container.addEventListener("controllerchange", onControllerChange);

    let interval: ReturnType<typeof setInterval> | undefined;
    let visible: (() => void) | undefined;
    // Start after the page has loaded and the browser is idle, so the offline copy never competes with the first paint.
    const start = () => container.register("/sw.js", { scope: "/", updateViaCache: "none" });
    const idle = (cb: () => void) => ("requestIdleCallback" in window ? (window as unknown as { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(cb) : setTimeout(cb, 1500));
    new Promise<void>((resolve) => (document.readyState === "complete" ? resolve() : window.addEventListener("load", () => resolve(), { once: true })))
      .then(() => new Promise<void>((resolve) => idle(resolve)))
      .then(() => (cancelled ? Promise.reject(new Error("cancelled")) : start()))
      .then((reg) => {
        if (cancelled) return;
        watch(reg);
        void container.ready.then(refreshStatus);
        // Look for a new version when the tab returns to the foreground, and hourly while it stays open.
        visible = () => {
          if (document.visibilityState === "visible") void reg.update().catch(() => {});
        };
        document.addEventListener("visibilitychange", visible);
        interval = setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
      })
      .catch(() => setOffline("unsupported"));

    return () => {
      cancelled = true;
      container.removeEventListener("message", onMessage);
      container.removeEventListener("controllerchange", onControllerChange);
      if (visible) document.removeEventListener("visibilitychange", visible);
      if (interval) clearInterval(interval);
    };
  }, [blocked]);

  const applyUpdate = useCallback(() => {
    const w = waiting.current;
    if (!w || isBusy()) return; // never update in the middle of a conversion
    updating.current = true;
    w.postMessage({ type: "SKIP_WAITING" });
  }, []);

  const install = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }, [installEvent]);

  const api = useMemo<PwaApi>(() => ({ online, offline, progress, updateReady, applyUpdate, canInstall: !!installEvent && !installed, installed, install }), [online, offline, progress, updateReady, applyUpdate, installEvent, installed, install]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** Removes the offline copy of the app (not user data, which is never stored) and the service worker. */
export async function clearOfflineData(): Promise<void> {
  if ("serviceWorker" in navigator) for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
  if ("caches" in window) for (const key of await caches.keys()) if (key.startsWith("fileforge-app-")) await caches.delete(key);
}
