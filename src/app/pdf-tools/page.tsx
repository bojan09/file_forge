import type { Metadata } from "next";
import { PdfToolsApp } from "@/components/pdf-tools/PdfToolsApp";

export const metadata: Metadata = { title: "PDF Tools" };

export default function PdfToolsPage() {
  return (
    <div className="enter mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">PDF Tools</h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted">Merge, split, reorder, rotate and extract pages, edit document properties and compress PDFs. Everything runs in your browser; files are never uploaded.</p>
      </header>
      <PdfToolsApp />
    </div>
  );
}
