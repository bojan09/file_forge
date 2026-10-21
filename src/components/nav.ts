export const NAV_ITEMS = [
  { href: "/", label: "Convert", short: "Home" },
  { href: "/formats/", label: "Formats", short: "Formats" },
  { href: "/settings/", label: "Settings", short: "Settings" },
  { href: "/help/", label: "Help", short: "Help" },
] as const;

export function isActive(pathname: string, href: string): boolean {
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/$/, "") : p);
  return norm(pathname) === norm(href);
}
