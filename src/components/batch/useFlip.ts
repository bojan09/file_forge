import { useLayoutEffect, useRef, type RefObject } from "react";
import { reducedMotion } from "@/lib/motion";

/**
 * FLIP animation for list reordering: after each render, rows whose vertical position changed
 * slide from their old position to the new one using the Web Animations API (no library).
 */
export function useFlip(containerRef: RefObject<HTMLElement | null>) {
  const prev = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const base = el.getBoundingClientRect().top;
    const next = new Map<string, number>();
    const skip = reducedMotion();
    el.querySelectorAll<HTMLElement>("[data-flip-id]").forEach((node) => {
      const id = node.dataset.flipId!;
      const top = node.getBoundingClientRect().top - base;
      next.set(id, top);
      const before = prev.current.get(id);
      if (!skip && before !== undefined && Math.abs(before - top) > 1 && typeof node.animate === "function") {
        node.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" });
      }
    });
    prev.current = next;
  });
}
