import type { Metadata } from "next";
import { SettingsForm } from "@/components/SettingsForm";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageShell title="Settings" intro="Preferences are stored only in this browser. Nothing is sent anywhere.">
      <SettingsForm />
    </PageShell>
  );
}
