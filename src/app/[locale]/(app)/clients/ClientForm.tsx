"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Store, Wallet, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { ClientQrCard } from "./ClientQrCard";
import { compareNatural } from "@/lib/sort";

export type ClientData = {
  id?: string;
  name: string;
  phone: string;
  address: string;
  wilayaCode: string;
  secteurId: string;
  activityType: string;
  tierId: string;
  creditLimit: number;
  creditDays: number;
  gpsLat: string;
  gpsLng: string;
};

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none focus:border-(--brand-500)";

export function ClientForm({
  locale,
  initial,
  wilayas,
  secteurs,
  tiers,
  labels,
  onSuccess,
  onClose,
  showQr,
}: {
  locale: string;
  initial: ClientData;
  wilayas: Array<{ code: number; nameAr: string; nameFr: string }>;
  secteurs: Array<{ id: string; name: string; wilayaCode: number }>;
  tiers: Array<{ id: string; name: string }>;
  labels: Record<string, string>;
  /// Called after a successful save. Defaults to navigating back to the list
  /// (detail-page usage); modal callers pass a refresh+close handler.
  onSuccess?: () => void;
  onClose?: () => void;
  /// Show the client QR on top in edit mode. Defaults true; the detail page
  /// already displays it above the form, so it opts out.
  showQr?: boolean;
}) {
  const showQrCode = showQr ?? true;
  const router = useRouter();
  const goList = () => {
    router.push(`/${locale}/clients`);
    router.refresh();
  };
  const handleSuccess = onSuccess ?? goList;
  const handleClose = onClose ?? goList;
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  /// Secteurs grow inline via the + button (uses the selected wilaya).
  const [secteurList, setSecteurList] = useState(secteurs);
  const [showSecteur, setShowSecteur] = useState(false);
  const [secteurName, setSecteurName] = useState("");
  const [secteurBusy, setSecteurBusy] = useState(false);
  const [qrCard, setQrCard] = useState<{
    qrUrl: string;
    code: string;
    company: { name: string; phone: string | null; logoUrl: string | null } | null;
  } | null>(null);
  const [gpsLink, setGpsLink] = useState(
    initial.gpsLat !== "" && initial.gpsLng !== ""
      ? `https://www.google.com/maps?q=${initial.gpsLat},${initial.gpsLng}`
      : ""
  );
  const [resolving, setResolving] = useState(false);
  const [locating, setLocating] = useState(false);

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setError(labels.gpsDenied);
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = Math.round(p.coords.latitude * 100000) / 100000;
        const lng = Math.round(p.coords.longitude * 100000) / 100000;
        set("gpsLat", String(lat));
        set("gpsLng", String(lng));
        setGpsLink(`https://www.google.com/maps?q=${lat},${lng}`);
        setLocating(false);
      },
      () => {
        setError(labels.gpsDenied);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function resolveGps() {
    if (!gpsLink.trim()) {
      set("gpsLat", "");
      set("gpsLng", "");
      return;
    }
    setResolving(true);
    setError(null);
    try {
      const res = await fetch("/api/geo/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: gpsLink.trim() }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.lat !== "number") {
        setError(labels.gpsInvalid);
        return;
      }
      set("gpsLat", String(data.lat));
      set("gpsLng", String(data.lng));
    } finally {
      setResolving(false);
    }
  }

  function set<K extends keyof ClientData>(k: K, v: ClientData[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function createSecteur() {
    const name = secteurName.trim();
    if (!name) return;
    const wilayaCode = Number(form.wilayaCode);
    if (!form.wilayaCode || Number.isNaN(wilayaCode)) {
      setError(labels.selectWilayaFirst);
      return;
    }
    const hit = secteurList.find(
      (s) => s.wilayaCode === wilayaCode && s.name.toLowerCase() === name.toLowerCase()
    );
    if (hit) {
      set("secteurId", hit.id);
      setSecteurName("");
      setShowSecteur(false);
      return;
    }
    setSecteurBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/secteurs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wilayaCode, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      const row = { id: data.id as string, name: data.name as string, wilayaCode: Number(data.wilayaCode) };
      setSecteurList((ss) => [...ss, row].sort((a, b) => compareNatural(a.name, b.name, locale)));
      set("secteurId", row.id);
      setSecteurName("");
      setShowSecteur(false);
    } finally {
      setSecteurBusy(false);
    }
  }

  async function submit() {
    if (!form.name.trim()) {
      setError("name_required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        wilayaCode: form.wilayaCode ? Number(form.wilayaCode) : null,
        secteurId: form.secteurId || null,
        activityType: form.activityType.trim() || null,
        tierId: form.tierId || null,
        creditLimit: form.creditLimit,
        creditDays: form.creditDays,
        gpsLat: form.gpsLat === "" ? null : Number(form.gpsLat),
        gpsLng: form.gpsLng === "" ? null : Number(form.gpsLng),
      };
      const res = await fetch(initial.id ? `/api/clients/${initial.id}` : "/api/clients", {
        method: initial.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      if (data.portalSecret) {
        setSecret(data.portalSecret as string);
        return;
      }
      handleSuccess();
    } finally {
      setBusy(false);
    }
  }

  const secteurOpts = secteurList.filter((s) => !form.wilayaCode || s.wilayaCode === Number(form.wilayaCode));

  useEffect(() => {
    if (!initial.id) return;
    let live = true;
    fetch(`/api/clients/${initial.id}/qr`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.dataUrl) {
          setQrCard({
            qrUrl: d.dataUrl as string,
            code: typeof d.code === "string" ? d.code : "",
            company: (d.company as { name: string; phone: string | null; logoUrl: string | null } | null) ?? null,
          });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [initial.id]);

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      {initial.id && qrCard && showQrCode && (
        <ClientQrCard
          company={qrCard.company}
          clientName={form.name.trim()}
          clientCode={qrCard.code}
          qrUrl={qrCard.qrUrl}
        />
      )}
      {secret && (
        <Card>
          <div className="text-sm font-bold">{labels.portalSecret}</div>
          <div className="my-1 text-center text-3xl font-black tracking-widest">{secret}</div>
          <div className="text-center text-xs opacity-60">{labels.secretOnce}</div>
          <Button className="mt-2 w-full" onClick={handleSuccess}>
            OK
          </Button>
        </Card>
      )}
      <Card>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600)">
            <Store size={16} />
          </span>
          <span className="text-sm font-black">{labels.secIdentity}</span>
        </div>
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.name}</label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.phone}</label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" placeholder="05/06/07…" dir="ltr" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.activity}</label>
              <Input value={form.activityType} onChange={(e) => set("activityType", e.target.value)} />
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600">
            <MapPin size={16} />
          </span>
          <span className="text-sm font-black">{labels.secLocation}</span>
        </div>
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.address}</label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.wilaya}</label>
              <select value={form.wilayaCode} onChange={(e) => { set("wilayaCode", e.target.value); set("secteurId", ""); }} className={inputCls}>
                <option value="">—</option>
                {wilayas.map((w) => (
                  <option key={w.code} value={w.code}>{w.code} · {w.nameAr}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.secteur}</label>
              <div className="flex gap-2">
                <select value={form.secteurId} onChange={(e) => set("secteurId", e.target.value)} className={`${inputCls} min-w-0 flex-1`}>
                  <option value="">—</option>
                  {secteurOpts.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  onClick={() => { setShowSecteur((s) => !s); setSecteurName(""); }}
                  className="shrink-0 px-3"
                  title={labels.newSecteur}
                  aria-label={labels.newSecteur}
                >
                  +
                </Button>
              </div>
              {showSecteur && (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={secteurName}
                    onChange={(e) => setSecteurName(e.target.value)}
                    placeholder={labels.secteurNamePh}
                    onKeyDown={(e) => { if (e.key === "Enter") void createSecteur(); }}
                  />
                  <Button type="button" onClick={() => void createSecteur()} disabled={secteurBusy || !secteurName.trim()} className="shrink-0 px-4">
                    {secteurBusy ? "…" : labels.save}
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.gps}</label>
            <div className="flex gap-2">
              <Input
                value={form.gpsLat}
                onChange={(e) => set("gpsLat", e.target.value)}
                placeholder="36.75"
                inputMode="decimal"
                dir="ltr"
                className="font-mono"
              />
              <Input
                value={form.gpsLng}
                onChange={(e) => set("gpsLng", e.target.value)}
                placeholder="3.06"
                inputMode="decimal"
                dir="ltr"
                className="font-mono"
              />
              <Button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                title={labels.useMyLocation}
                aria-label={labels.useMyLocation}
                className="shrink-0 px-3"
              >
                <Crosshair size={16} className={locating ? "animate-spin" : ""} />
              </Button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.gpsLink}</label>
            <div className="flex gap-2">
              <Input
                value={gpsLink}
                onChange={(e) => setGpsLink(e.target.value)}
                onBlur={() => void resolveGps()}
                placeholder="https://maps.app.goo.gl/…"
                dir="ltr"
                className="font-mono"
              />
              <Button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                title={labels.useMyLocation}
                aria-label={labels.useMyLocation}
                className="shrink-0 px-3"
              >
                <Crosshair size={16} className={locating ? "animate-spin" : ""} />
              </Button>
              <Button type="button" variant="secondary" onClick={() => void resolveGps()} disabled={resolving}>
                📍
              </Button>
            </div>
            {form.gpsLat !== "" && form.gpsLng !== "" ? (
              <a
                href={`https://www.google.com/maps?q=${form.gpsLat},${form.gpsLng}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs font-bold text-(--brand-600)"
              >
                📍 {form.gpsLat}, {form.gpsLng} ↗
              </a>
            ) : (
              <p className="mt-1 text-xs opacity-60">{labels.gpsHint}</p>
            )}
          </div>
        </div>
      </Card>
      <Card>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500">
            <Wallet size={16} />
          </span>
          <span className="text-sm font-black">{labels.secBilling}</span>
        </div>
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.tier}</label>
            <select value={form.tierId} onChange={(e) => set("tierId", e.target.value)} className={inputCls}>
              <option value="">—</option>
              {tiers.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>
      {!secret && (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleClose} className="flex-1">
            {labels.cancel}
          </Button>
          <Button onClick={submit} disabled={busy} className="flex-[2]">
            {labels.save}
          </Button>
        </div>
      )}
    </div>
  );
}
