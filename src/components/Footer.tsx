import Link from "next/link";

export function Footer() {
  return (
    <footer className="mx-auto mt-10 max-w-6xl px-4 pb-10 text-sm text-muted sm:px-6">
      <div className="flex flex-col items-start justify-between gap-3 border-t border-line pt-6 sm:flex-row sm:items-center">
        <p>FileForge converts files in your browser. Free, no account, no uploads.</p>
        <nav aria-label="Footer" className="flex gap-4">
          <Link href="/privacy/" className="underline-offset-4 hover:text-fg hover:underline">
            Privacy
          </Link>
          <Link href="/formats/" className="underline-offset-4 hover:text-fg hover:underline">
            Formats
          </Link>
          <Link href="/help/" className="underline-offset-4 hover:text-fg hover:underline">
            Help
          </Link>
        </nav>
      </div>
    </footer>
  );
}
