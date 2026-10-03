"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Crosshair, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { queueOp, getVanSnapshot } from "@/lib/sync/client";
import { clientQrPayload, generateOfflineClientCode } from "@/lib/clients/validation";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

/// Livreur adds a client: online → POST /api/clients, offline → outbox.
/// The account code is minted ON THE PHONE (time + random — unique per
/// device, no two livreurs mint the same), so the QR is shown/printed
/// immediately and the server honors the same code on sync.

/// Livreur adds a client: online → POST /api/clients, offline → outbox.
/// Captures GPS for the client file when available.
export function NewClient({
  locale,
  day,
  companyId,
  wilayas,
  secteurs,
  tiers,
  labels,
}: {
  locale: string;
  day: string;
  companyId: string;
  wilayas: Array<{ code: number; nameAr: string; nameFr: string }>;
  secteurs: Array<{ id: string; name: string; wilayaCode: number }>;
  tiers: Array<{ id: string; name: string }>;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [activity, setActivity] = useState("");
  const [wilaya, setWilaya] = useState("");
  const [secteur, setSecteur] = useState("");
  const [tier, setTier] = useState("");
  const [secteurList, setSecteurList] = useState(secteurs);
  const [showSecteur, setShowSecteur] = useState(false);
  const [secteurName, setSecteurName] = useState("");
  const [secteurBusy, setSecteurBusy] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsText, setGpsText] = useState("");
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  /// Offline ref fallbacks (wilayas/secteurs/tiers from the last sync).
  const [snapRefs, setSnapRefs] = useState<{ wilayas: typeof wilayas; secteurs: typeof secteurs; tiers: typeof tiers } | null>(null);
  useEffect(() => {
    if (wilayas.length && secteurs.length) return;
    getVanSnapshot().then((s) => {
      if (!s) return;
      const refs = {
        wilayas: (s.wilayas ?? []) as typeof wilayas,
        secteurs: (s.secteurs ?? []) as typeof secteurs,
        tiers: (s.tiers ?? []) as typeof tiers,
      };
      setSnapRefs(refs);
      setSecteurList((cur) => (cur.length ? cur : refs.secteurs));
    }).catch(() => {});
  }, [wilayas.length, secteurs.length]);
  /// Created account: QR shown immediately (offline or online).
  const [created, setCreated] = useState<{ code: string; name: string; qr: string; offline: boolean } | null>(null);

  const secteurOpts = secteurList.filter((s) => !wilaya || s.wilayaCode === Number(wilaya));
  const effWilayas = wilayas.length ? wilayas : (snapRefs?.wilayas ?? []);
  const effTiers = tiers.length ? tiers : (snapRefs?.tiers ?? []);

  async function createSecteur() {
    const name = secteurName.trim();
    if (!name || !wilaya) return;
    setSecteurBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/secteurs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wilayaCode: Number(wilaya), name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "failed");
        return;
      }
      const row = { id: data.id as string, name: data.name as string, wilayaCode: Number(data.wilayaCode) };
      setSecteurList((ss) => [...ss, row].sort((a, b) => a.name.localeCompare(b.name)));
      setSecteur(row.id);
      setSecteurName("");
      setShowSecteur(false);
    } finally {
      setSecteurBusy(false);
    }
  }

  function captureGps() {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = Math.round(p.coords.latitude * 100000) / 100000;
        const lng = Math.round(p.coords.longitude * 100000) / 100000;
        setGps({ lat, lng });
        setGpsText(`${lat}, ${lng}`);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function typedGps(): { lat: number; lng: number } | null {
    const m = gpsText.trim().split(/[,;\s]+/).map(Number);
    if (m.length >= 2 && Number.isFinite(m[0]) && Number.isFinite(m[1]) && Math.abs(m[0]) <= 90 && Math.abs(m[1]) <= 180) {
      return { lat: m[0], lng: m[1] };
    }
    return null;
  }

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    // Mint the account code on the phone: unique per device (time+random),
    // honored by the server — the QR below is final, online or offline.
    const code = generateOfflineClientCode();
    const body: Record<string, unknown> = {
      name: name.trim(),
      code,
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
      ...(activity.trim() ? { activityType: activity.trim() } : {}),
      ...(wilaya ? { wilayaCode: Number(wilaya) } : {}),
      ...(secteur ? { secteurId: secteur } : {}),
      ...(tier ? { tierId: tier } : {}),
      ...(() => {
        const g = gps ?? typedGps();
        return g ? { gpsLat: g.lat, gpsLng: g.lng } : {};
      })(),
    };
    let qr = "";
    try {
      qr = await QRCode.toDataURL(clientQrPayload(companyId, code), { margin: 1, width: 320 });
    } catch {
      setError("save_failed");
      setSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(d?.error ?? "failed");
        return;
      }
      setCreated({ code, name: name.trim(), qr, offline: false });
    } catch {
      try {
        await queueOp("client", body);
        setQueued(true);
        setCreated({ code, name: name.trim(), qr, offline: true });
      } catch {
        setError("save_failed");
      }
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setName(""); setPhone(""); setAddress(""); setActivity("");
    setWilaya(""); setSecteur(""); setTier("");
    setGps(null); setGpsText(""); setError(null);
    setQueued(false); setCreated(null);
  }

  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  /// Save the QR as a PNG that the user can actually keep:
  /// 1. native (APK): write into Documents + open the share sheet
  ///    (gallery / WhatsApp / …) — anchor downloads silently fail in WebViews.
  /// 2. mobile browsers: Web Share API with the file.
  /// 3. fallback: classic blob download.
  async function saveQr() {
    if (!created) return;
    setSaveMsg(null);
    const fileName = `${created.code}.png`;
    const base64 = created.qr.includes(",") ? created.qr.split(",")[1] : created.qr;
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      try {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Documents });
        try {
          const { Share } = await import("@capacitor/share");
          const uri = await Filesystem.getUri({ path: fileName, directory: Directory.Documents });
          await Share.share({ title: created.code, text: created.name, url: uri.uri });
          setSaveMsg(labels.qrShared ?? labels.qrSaved ?? "saved");
        } catch {
          setSaveMsg(labels.qrSaved ?? "saved");
        }
        return;
      } catch {
        /* fall through to browser methods */
      }
    }
    try {
      const blob = await (await fetch(created.qr)).blob();
      const file = new File([blob], fileName, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (d: { files: File[] }) => boolean;
        share?: (d: { files: File[]; title?: string }) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: created.code });
        setSaveMsg(labels.qrShared ?? labels.qrSaved ?? "saved");
        return;
      }
    } catch {
      /* fall through to download */
    }
    try {
      const blob = await (await fetch(created.qr)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setSaveMsg(labels.qrSaved ?? "saved");
    } catch {
      setSaveMsg(labels.qrSaveFail ?? "failed");
    }
  }

  if (created) {
    return (
      <div className="space-y-3 p-4 pb-8 md:p-5">
        <h1 className="flex items-center gap-2 text-lg font-black">
          <UserPlus size={19} className="text-(--brand-600)" />
          {labels.newClient}
        </h1>
        <p className="text-sm font-bold opacity-70">{labels.qrReady}</p>
        <div className="rounded-2xl border border-(--border-default) bg-white p-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={created.qr} alt={created.code} className="mx-auto h-56 w-56" />
          <p className="mt-2 text-lg font-black text-black" dir="auto">{created.name}</p>
          <p className="font-mono text-sm font-bold text-black" dir="ltr">{created.code}</p>
        </div>
        {created.offline && (
          <p className="rounded-xl bg-amber-500/10 p-2.5 text-xs font-bold text-amber-600">{labels.pendingSync}</p>
        )}
        {saveMsg && (
          <p className="rounded-xl bg-emerald-500/10 p-2.5 text-xs font-bold text-emerald-600">{saveMsg}</p>
        )}
        <div className="flex gap-2">
          <Button onClick={() => void saveQr()} variant="secondary" className="h-12 flex-1 text-base">
            ⬇ {labels.saveQr}
          </Button>
          <Button onClick={reset} className="h-12 flex-1 text-base">{labels.another}</Button>
        </div>
        <Button variant="secondary" onClick={() => router.push(`/${locale}/livreur/${day}`)} className="h-12 w-full text-base">
          {labels.clients}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4 pb-8 md:p-5">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => router.push(`/${locale}/livreur/${day}/dashboard`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <h1 className="flex items-center gap-2 text-lg font-black">
          <UserPlus size={19} className="text-(--brand-600)" />
          {labels.newClient}
        </h1>
      </div>

      {queued && (
        <p className="rounded-xl bg-amber-500/10 p-2.5 text-xs font-bold text-amber-600">⏳ queued offline — will sync</p>
      )}
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}

      <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600)">
            <UserPlus size={16} />
          </span>
          <span className="text-sm font-black">{labels.newClient}</span>
        </div>
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.newClient}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.phoneOpt}</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.activityOpt}</label>
              <Input value={activity} onChange={(e) => setActivity(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.addressOpt}</label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.wilayaOpt}</label>
              <select
                value={wilaya}
                onChange={(e) => { setWilaya(e.target.value); setSecteur(""); }}
                className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)"
              >
                <option value="">—</option>
                {effWilayas.map((w) => (
                  <option key={w.code} value={w.code}>{w.code} · {locale === "ar" ? w.nameAr : w.nameFr}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.secteurOpt}</label>
              <div className="flex gap-2">
                <select
                  value={secteur}
                  onChange={(e) => setSecteur(e.target.value)}
                  className="h-11 min-w-0 flex-1 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)"
                >
                  <option value="">—</option>
                  {secteurOpts.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => { setShowSecteur((v) => !v); setSecteurName(""); }}
                  disabled={!wilaya}
                  aria-label="+"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500) text-lg font-black text-white disabled:opacity-30"
                >
                  +
                </button>
              </div>
              {showSecteur && (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={secteurName}
                    onChange={(e) => setSecteurName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void createSecteur(); }}
                  />
                  <Button type="button" onClick={() => void createSecteur()} disabled={secteurBusy || !secteurName.trim()} className="shrink-0 px-4">
                    {secteurBusy ? "…" : labels.confirm}
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.tierOpt}</label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)"
            >
              <option value="">—</option>
              {effTiers.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
        <div className="flex gap-2">
          <Input
            value={gpsText}
            onChange={(e) => { setGpsText(e.target.value); setGps(null); }}
            placeholder="36.75, 3.06"
            inputMode="decimal"
            dir="ltr"
            className="font-mono"
          />
          <button
            onClick={captureGps}
            disabled={locating}
            title={labels.useGps}
            aria-label={labels.useGps}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border",
              gps ? "border-emerald-500 bg-emerald-500/10 text-emerald-600" : "border-(--border-default)"
            )}
          >
            <Crosshair size={16} className={locating ? "animate-spin" : ""} />
          </button>
        </div>
        {gps && (
          <p className="mt-1 font-mono text-[11px] font-bold text-emerald-600" dir="ltr">
            {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
          </p>
        )}
      </div>

      <Button onClick={() => void save()} disabled={saving || !name.trim()} className="h-12 w-full text-base">
        {saving ? "…" : labels.confirm}
      </Button>
    </div>
  );
}
