"use client";

import { useTranslations } from "next-intl";
import { UpdateManager } from "@/components/settings/UpdateManager";
import { SettingsPanel, useSectionText } from "@/components/settings/SettingsPanel";

export default function UpdatesSettingsPage() {
  const tl = useTranslations("license");
  const { title, description } = useSectionText("updates", "updatesDesc");

  return (
    <SettingsPanel title={title} description={description}>
      <UpdateManager
        labels={{
          title: tl("updates"), check: tl("check"), download: tl("download"), install: tl("install"),
          available: tl("available"), uptodate: tl("uptodate"), downloaded: tl("downloaded"),
        }}
      />
    </SettingsPanel>
  );
}
