import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Section } from "@/components/PageShell";

export const metadata: Metadata = { title: "Help" };

const FAQ: { q: string; a: string }[] = [
  { q: "My file was rejected", a: "Check the extension (TXT, MD, HTML, CSV, JPG, PNG, WebP, and the experimental DOCX, XLSX and PDF) and the size limit for that type on the Formats page. Renaming a file doesn't change its content: a PNG named .jpg is refused." },
  { q: "The PDF shows question marks", a: "The PDF font covers Latin, Cyrillic and Greek. Characters from other scripts are replaced by “?”. Convert to DOCX instead; it keeps all characters." },
  { q: "The HTML result looks different from the web page", a: "HTML conversion is approximate. Styles, scripts, forms, media and remote images are ignored, and layouts are flattened into reading order. Save simple, document-style HTML for best results." },
  { q: "My CSV table is cut off or tiny", a: "Wide tables shrink their text to fit. Use landscape orientation, narrower margins, or DOCX for very wide data." },
  { q: "Conversion is slow or the tab crashed", a: "Large files and large images need memory. Try a smaller file, the “Small file” image quality, or conservative processing in Settings. You can cancel a running conversion at any time." },
  { q: "The image PDF isn't searchable", a: "Image PDFs contain a picture. FileForge does not perform OCR." },
  { q: "Download didn't start", a: "Use the Download File button again; on some phones the file lands in a Downloads folder or the share sheet. Pop-up or download blockers may need to allow this site." },
  { q: "Why does it say Experimental?", a: "Word to PDF, Excel to PDF and PDF to Word rebuild the content from the file's structure, not its exact layout. They list what was left out (for example charts, comments, footnotes, pictures in a PDF). Compare the result with the original before you rely on it. The Formats page explains each label." },
  { q: "My PDF can't be converted to Word", a: "Only PDFs that contain selectable text work. A scanned PDF is a picture of text and needs OCR, which FileForge doesn't include. Password-protected PDFs can't be opened; FileForge never removes protection. Damaged files and files with the wrong extension are refused with the reason." },
  { q: "The Word or Excel result is missing something", a: "Check the notes shown before and after conversion: they count what couldn't be carried over (tracked-change deletions, text boxes, charts, merged cells, hidden rows). For Excel, pick the sheet and print area under Advanced options. Formulas show the result saved in the file and are never recalculated." },
  { q: "Does it work offline?", a: "Yes, after the first visit has finished storing the app (Settings shows when it is ready). Conversions, previews, fonts and every page work without a connection. If Data Saver is on, the offline copy is skipped. Install it from your browser's install button, or Share then Add to Home Screen on iPhone and iPad." },
  { q: "A banner says a new version is ready", a: "Updates never start by themselves. The button is disabled while a conversion runs. Updating reloads the page, which clears the current file and result, so download first." },
  { q: "Offline mode seems stuck or out of date", a: "Open Settings and choose Remove offline copy, then reload the page while online to download it again. This only removes the app's own files; FileForge never stores your documents." },
  { q: "Are my preferences saved?", a: "Only non-sensitive settings (theme, defaults) are stored in your browser's local storage. You can clear them in Settings." },
];

export default function HelpPage() {
  return (
    <PageShell title="Help" intro="How FileForge works and what to try when something goes wrong.">
      <Section title="How to convert a file">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            On <Link className="text-accent-text underline underline-offset-4" href="/">Convert</Link>, drop a file or choose one.
          </li>
          <li>Check the preview and any notices, then pick PDF or DOCX and adjust page settings.</li>
          <li>Press Convert. When it finishes, download the result and review the quality checks.</li>
        </ol>
      </Section>
      <Section title="Troubleshooting">
        <div className="divide-y divide-line">
          {FAQ.map((item) => (
            <details key={item.q} className="group py-2.5">
              <summary className="cursor-pointer list-none text-sm font-semibold text-fg marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="mr-2 inline-block text-accent-text transition-transform group-open:rotate-90">›</span>
                {item.q}
              </summary>
              <p className="mt-2 pl-5">{item.a}</p>
            </details>
          ))}
        </div>
      </Section>
      <Section title="Keyboard">
        <ul>
          <li>Tab to the upload area and press Enter or Space to open the file picker.</li>
          <li>All settings are standard form controls and work with the keyboard and screen readers.</li>
        </ul>
      </Section>
    </PageShell>
  );
}
