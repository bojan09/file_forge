"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CloseIcon, MenuIcon } from "./icons";
import { LogoMark, Wordmark } from "./Logo";
import { NAV_ITEMS, isActive } from "./nav";
import { ThemeToggle } from "./ThemeToggle";
import { useGoHome } from "./useGoHome";

export function Header() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const goHome = useGoHome(pathname);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="FileForge home" onClick={goHome}>
          <LogoMark size={34} />
          <Wordmark className="text-lg" />
        </Link>
        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link" aria-current={isActive(pathname, item.href) ? "page" : undefined} onClick={item.href === "/" ? goHome : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden md:block">
          <ThemeToggle />
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm ml-auto md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
        </button>
      </div>
      {open && (
        <div id="mobile-menu" className="enter border-t border-line bg-bg px-4 py-3 md:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1">
              <Link href="/privacy/" className="nav-link" onClick={() => setOpen(false)}>
                Privacy
              </Link>
              <Link href="/formats/" className="nav-link" onClick={() => setOpen(false)}>
                Formats
              </Link>
            </div>
            <ThemeToggle />
          </div>
        </div>
      )}
    </header>
  );
}
