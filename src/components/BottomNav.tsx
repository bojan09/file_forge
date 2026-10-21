"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GearIcon, HelpIcon, HomeIcon, LayersIcon } from "./icons";
import { NAV_ITEMS, isActive } from "./nav";

const ICONS = [HomeIcon, LayersIcon, GearIcon, HelpIcon];

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Primary mobile" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {NAV_ITEMS.map((item, i) => {
          const Icon = ICONS[i]!;
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold transition-colors ${active ? "text-accent-text" : "text-muted hover:text-fg"}`}
              >
                <Icon size={22} />
                {item.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
