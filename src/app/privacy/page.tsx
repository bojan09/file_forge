import type { Metadata } from "next";
import { PageShell, Section } from "@/components/PageShell";

export const metadata: Metadata = { title: "Privacy & About" };

export default function PrivacyPage() {
  return (
    <PageShell title="Privacy & About" intro="FileForge is a free converter that runs in your browser. This page explains what that does and doesn't mean.">
      <Section title="What happens to your file">
        <ul>
          <li>Your file is read, previewed, converted and verified in your browser, in memory. There is no server that receives it.</li>
          <li>The converted file is created on your device and offered as a download. Temporary memory and download links are released when you start over or leave.</li>
          <li>HTML you convert is never executed, and images, stylesheets, scripts or fonts it references are never fetched.</li>
        </ul>
      </Section>
      <Section title="What FileForge doesn&apos;t do">
        <ul>
          <li>No uploads, no accounts, no payments, no database, no cloud storage of files.</li>
          <li>No analytics on file contents or file names.</li>
        </ul>
      </Section>
      <Section title="Offline copy and installation">
        <ul>
          <li>After your first visit FileForge stores its own pages, scripts, fonts and icons on your device (about 8 MB) so it works without a connection. You can remove this in Settings, and it is skipped when your device asks to save data.</li>
          <li>Your files, previews and results are never part of that copy. They exist only in memory while you use the page. This is checked by automated tests that read the stored copy and search it for the content of a test file.</li>
          <li>The service worker only answers requests for FileForge&apos;s own files. It makes no requests of its own to other sites.</li>
        </ul>
      </Section>
      <Section title="What is stored locally">
        <p>Only non-sensitive preferences (theme, accent, motion, default output, page and image defaults, filename suffix) are saved in your browser&apos;s local storage. You can erase them in Settings.</p>
      </Section>
      <Section title="Limits of this claim">
        <ul>
          <li>Like any website, the host that serves FileForge can log ordinary requests for the site&apos;s own pages and assets (for example IP address and URL). File contents are never part of those requests.</li>
          <li>Local processing can&apos;t protect against a compromised device, malicious browser extensions, or shared computers. Close the tab when you are done on a shared machine.</li>
          <li>You can verify the no-upload behavior yourself: open your browser&apos;s developer tools, watch the Network tab, and convert a file.</li>
        </ul>
      </Section>
      <Section title="About">
        <p>FileForge converts TXT, Markdown, HTML, CSV and images to PDF or DOCX, and experimentally Word and Excel files to PDF and text PDFs to Word, all on your device. It is built with open-source libraries: pdfmake, docx, markdown-it, DOMPurify, PapaParse, fflate, JSZip and pdf.js.</p>
      </Section>
    </PageShell>
  );
}
