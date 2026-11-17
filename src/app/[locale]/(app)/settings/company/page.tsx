"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { SettingsPanel, useSectionText } from "@/components/settings/SettingsPanel";
import { api } from "@/components/settings/api";

import { ErrText } from "@/components/ui/ErrText";
const FIELDS: Array<{ key: string; dir?: "ltr" }> = [
  { key: "name" },
  { key: "phone", dir: "ltr" },
  { key: "address" },
  { key: "email", dir: "ltr" },
  { key: "rc", dir: "ltr" },
  { key: "nif", dir: "ltr" },
  { key: "ai", dir: "ltr" },
  { key: "nis", dir: "ltr" },
  { key: "bankName" },
  { key: "rib", dir: "ltr" },
];

export default function CompanySettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { title, description } = useSectionText("company", "companyDesc");
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [logoUrl, setLogoUrl] = useState("");
  const [signatureUrl, setSignatureUrl] = useState("");
  const [stampUrl, setStampUrl] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api("/api/settings/company")
      .then((d) => {
        const row = d as Record<string, unknown>;
        const init: Record<string, string> = {};
        for (const f of FIELDS) init[f.key] = typeof row[f.key] === "string" ? (row[f.key] as string) : "";
        setForm(init);
        setLogoUrl(typeof row.logoUrl === "string" ? row.logoUrl : "");
        setSignatureUrl(typeof row.signatureUrl === "string" ? row.signatureUrl : "");
        setStampUrl(typeof row.stampUrl === "string" ? row.stampUrl : "");
      })
      .catch(() => setError("load_failed"));
  }, []);

  async function upload(file: File | undefined, slot: "logo" | "signature" | "stamp") {
    if (!file) return;
    setUploading(slot);
    setError(null);
    try {
      const data = new FormData();
      data.append("file", file);
      data.append("dir", "company");
      const res = await fetch("/api/uploads", { method: "POST", body: data });
      if (!res.ok) {
        setError("upload_failed");
        return;
      }
      const url = (await res.json()).url as string;
      if (slot === "logo") setLogoUrl(url);
      else if (slot === "signature") setSignatureUrl(url);
      else setStampUrl(url);
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    if (!form || !form.name.trim()) {
      setError("name_required");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api("/api/settings/company", {
        method: "PATCH",
        body: JSON.stringify({
          ...form,
          logoUrl: logoUrl || null,
          signatureUrl: signatureUrl || null,
          stampUrl: stampUrl || null,
        }),
      });
      setSaved(true);
    } catch {
      setError("save_failed");
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <p className="py-6 text-sm opacity-60">{tc("loading")}</p>;

  return (
    <SettingsPanel title={title} description={description}>
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              { slot: "logo", url: logoUrl, set: setLogoUrl, label: t("logo"), btn: t("changeLogo"), ph: "🏢" },
              { slot: "signature", url: signatureUrl, set: setSignatureUrl, label: t("signature"), btn: t("changeSignature"), ph: "✒️" },
              { slot: "stamp", url: stampUrl, set: setStampUrl, label: t("stamp"), btn: t("changeStamp"), ph: "🔏" },
            ] as const
          ).map((s) => (
            <div key={s.slot}>
              <label className="mb-1 block text-sm font-bold">{s.label}</label>
              <div className="flex items-center gap-2">
                {s.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt={s.slot} className="h-16 w-16 shrink-0 rounded-xl bg-white object-contain" />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-2xl">{s.ph}</span>
                )}
                <div className="flex min-w-0 flex-col gap-1">
                  <label className="cursor-pointer rounded-lg bg-(--bg-sunken) px-3 py-2 text-center text-xs font-black hover:bg-(--border-subtle)">
                    {uploading === s.slot ? "…" : s.btn}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0], s.slot)} />
                  </label>
                  {s.url && (
                    <Button variant="ghost" onClick={() => s.set("")} className="px-2 py-1 text-xs">✕</Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.key === "name" || f.key === "address" ? "sm:col-span-2" : ""}>
              <label className="mb-1 block text-sm font-bold">{t(f.key)}</label>
              <Input
                value={form[f.key] ?? ""}
                dir={f.dir}
                onChange={(e) => { setForm({ ...form, [f.key]: e.target.value }); setSaved(false); }}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={() => void save()} disabled={saving || uploading !== null} className="flex-[2]">
            {tc("save")}
          </Button>
          {saved && <span className="text-xs font-black text-emerald-600">✓</span>}
        </div>
      </Card>
    </SettingsPanel>
  );
}
