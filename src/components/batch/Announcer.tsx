/** Visually hidden live region so status changes are spoken by screen readers. */
export function Announcer({ message, seq }: { message: string; seq: number }) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer">
      {message}
      {seq % 2 ? " " : ""}
    </div>
  );
}
