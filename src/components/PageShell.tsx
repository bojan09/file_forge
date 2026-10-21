import type { ReactNode } from "react";

export function PageShell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="enter mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        {intro && <p className="text-base leading-relaxed text-muted">{intro}</p>}
      </header>
      {children}
    </div>
  );
}

export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="card space-y-3 p-5 sm:p-6" aria-labelledby={`${id ?? title}-h`.replace(/\s+/g, "-")}>
      <h2 id={`${id ?? title}-h`.replace(/\s+/g, "-")} className="text-lg font-bold">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted [&_strong]:text-fg [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">{children}</div>
    </section>
  );
}
