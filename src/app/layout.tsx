import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { PwaBanner } from "@/components/PwaBanner";
import { BatchProvider } from "@/lib/batch";
import { ConverterProvider } from "@/lib/converter";
import { PwaProvider } from "@/lib/pwa";
import { THEME_INIT_SCRIPT, ThemeProvider } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FileForge – Convert your files to PDF or Word, privately", template: "%s · FileForge" },
  description: "Free browser-only converter for TXT, Markdown, HTML, CSV and images to PDF or editable DOCX, EPUB books, plus experimental Word, Excel and PDF conversions. Your files are processed on your device and never uploaded.",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "FileForge", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070d1c" },
    { media: "(prefers-color-scheme: light)", color: "#f3f6fc" },
  ],
};

// Fallback CSP for hosts that cannot set headers. vercel.json sends the stricter header version.
// connect-src 'self' means page scripts cannot send data to any other origin.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" data-accent="indigo" data-motion="system" suppressHydrationWarning>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <meta name="referrer" content="no-referrer" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <ThemeProvider>
          <PwaProvider>
          <ConverterProvider>
            <BatchProvider>
            <Header />
            <main id="main" tabIndex={-1} className="mx-auto min-h-[60vh] max-w-6xl px-4 pb-24 pt-6 outline-none sm:px-6 md:pb-6 md:pt-10">
              {children}
            </main>
            <Footer />
            <BottomNav />
            <PwaBanner />
            </BatchProvider>
          </ConverterProvider>
          </PwaProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
