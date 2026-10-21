/** True when animations should be skipped (Settings "Reduced", or Settings "System" with the OS preference set). */
export function reducedMotion(): boolean {
  if (typeof document === "undefined") return true;
  const m = document.documentElement.dataset.motion;
  if (m === "reduced") return true;
  if (m === "full") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
