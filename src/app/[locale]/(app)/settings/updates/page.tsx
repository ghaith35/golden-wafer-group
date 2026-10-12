"use client";

import { useTranslations } from "next-intl";
import { UpdaterPanel } from "@/components/settings/UpdaterPanel";
import { SettingsPanel, useSectionText } from "@/components/settings/SettingsPanel";

export default function UpdatesSettingsPage() {
  const tl = useTranslations("license");
  const { title, description } = useSectionText("updates", "updatesDesc");

  return (
    <SettingsPanel title={title} description={description}>
      <UpdaterPanel
        labels={{
          appVersion: tl("appVersion"), runningBundle: tl("runningBundle"), channel: tl("channel"),
          status: tl("status"), statusInstalled: tl.raw("statusInstalled"), checkUpdate: tl("checkUpdate"),
          notes: tl("notes"), fullInstaller: tl("fullInstaller"), feedMissing: tl("feedMissing"),
          genericError: tl("genericError"),
          howTitle: tl("howTitle"), how1: tl("how1"), how2: tl("how2"), how3: tl("how3"),
          check: tl("check"), download: tl("download"), install: tl("install"),
          webAvailable: tl("webAvailable"), uptodate: tl("webUptodate"), webReady: tl("webReady"),
          webApplying: tl("webApplying"), webApplied: tl("webApplied"),
          adminOnly: tl("adminOnly"), desktopOnly: tl("desktopOnly"),
        }}
      />
    </SettingsPanel>
  );
}
