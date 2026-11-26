"use client";

import { useMemo, useState } from "react";
import { Camera, CalendarDays, Lock, MapPin, Phone, Truck, UserRound } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { KpiCard } from "@/components/ui/Card";
import { ProductThumb } from "@/components/products/ProductThumb";
import { cn } from "@/lib/utils";

type Visit = {
  id: string; at: string; note: string | null; lat: number | null; lng: number | null;
  client: { id: string; name: string; code: string; phone: string | null };
  van: { id: string; name: string } | null;
  driver: { id: string; name: string } | null;
  photos: string[];
};
type Group = {
  key: string; ymd: string; date: Date;
  van: { id: string; name: string } | null; driver: { id: string; name: string } | null;
  visits: Visit[];
};

const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function ClosedClient({ locale, visits, labels }: { locale: string; visits: Visit[]; labels: Record<string, string> }) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [vanId, setVanId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const loc = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "fr" ? "fr-DZ" : "en-GB";
  const vans = useMemo(() => [...new Map(visits.filter((v) => v.van).map((v) => [v.van!.id, v.van!.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [visits]);
  const drivers = useMemo(() => [...new Map(visits.filter((v) => v.driver).map((v) => [v.driver!.id, v.driver!.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [visits]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const m = new Map<string, Group>();
    for (const v of visits) {
      const d = new Date(v.at);
      const ymd = ymdOf(d);
      if (from && ymd < from) continue;
      if (to && ymd > to) continue;
      if (vanId && v.van?.id !== vanId) continue;
      if (driverId && v.driver?.id !== driverId) continue;
      if (needle && ![v.client.name, v.client.code, v.driver?.name, v.van?.name].some((x) => x?.toLowerCase().includes(needle))) continue;
      const key = `${v.driver?.id ?? "-"}|${v.van?.id ?? "-"}|${ymd}`;
      const g = m.get(key) ?? { key, ymd, date: d, van: v.van, driver: v.driver, visits: [] };
      g.visits.push(v);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.ymd.localeCompare(a.ymd) || (a.driver?.name ?? "").localeCompare(b.driver?.name ?? ""));
  }, [visits, q, from, to, vanId, driverId]);

  const totals = useMemo(() => {
    const clients = new Set<string>();
    let photos = 0;
    for (const g of groups) for (const v of g.visits) { clients.add(`${g.ymd}|${v.client.id}`); photos += v.photos.length; }
    return { clients: clients.size, days: new Set(groups.map((g) => g.ymd)).size, photos };
  }, [groups]);

  const open = groups.find((g) => g.key === openKey) ?? null;
  const filtered = !!(q || from || to || vanId || driverId);
  const selectCls = "h-11 min-w-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)";

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-start gap-3">
        <span className="bg-gradient-brand flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-(--brand-contrast)"><Lock size={22} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-black">{labels.title}</h1>
          <p className="text-xs opacity-60">{labels.subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <KpiCard label={labels.kpiClients} value={String(totals.clients)} icon={<Lock size={18} />} accent="bg-red-500/15 text-red-500" valueClassName="whitespace-normal! text-clip! break-words leading-tight" compact />
        <KpiCard label={labels.kpiDays} value={String(totals.days)} icon={<CalendarDays size={18} />} accent="bg-amber-500/15 text-amber-600" compact />
        <KpiCard label={labels.kpiPhotos} value={String(totals.photos)} icon={<Camera size={18} />} accent="bg-emerald-500/15 text-emerald-600" compact />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <div className="col-span-2 md:col-span-2"><Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="flex items-center gap-1.5 text-xs font-bold"><span className="shrink-0 opacity-60">{labels.from}</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} dir="ltr" className={cn(selectCls, "w-full")} /></label>
        <label className="flex items-center gap-1.5 text-xs font-bold"><span className="shrink-0 opacity-60">{labels.to}</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} dir="ltr" className={cn(selectCls, "w-full")} /></label>
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={selectCls}>
          <option value="">{labels.allDrivers}</option>
          {drivers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={vanId} onChange={(e) => setVanId(e.target.value)} className={selectCls}>
          <option value="">{labels.allVans}</option>
          {vans.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      {filtered && (
        <button type="button" onClick={() => { setQ(""); setFrom(""); setTo(""); setVanId(""); setDriverId(""); }} className="text-xs font-black text-(--brand-600)">✕ {labels.reset}</button>
      )}

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-(--border-default) p-10 text-center text-sm opacity-60">{labels.empty}</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => {
            const photos = g.visits.reduce((n, v) => n + v.photos.length, 0);
            const previews = g.visits.flatMap((v) => v.photos.map((url) => ({ url, name: v.client.name }))).slice(0, 4);
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => setOpenKey(g.key)}
                className="flex flex-col gap-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 text-start transition-colors hover:border-(--brand-500) active:scale-[0.99]"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600)">
                    <span className="text-base font-black leading-none tabular-nums">{g.date.getDate()}</span>
                    <span className="text-[11px] font-black uppercase">{g.date.toLocaleDateString(loc, { month: "short" })}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black">{g.date.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
                    <div className="flex flex-wrap items-center gap-x-3 text-xs font-bold opacity-70">
                      <span className="flex items-center gap-1"><UserRound size={12} />{g.driver?.name ?? labels.unknown}</span>
                      <span className="flex items-center gap-1"><Truck size={12} />{g.van?.name ?? labels.unknown}</span>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-red-600 px-2.5 py-1 text-xs font-black tabular-nums text-white">🔒 {g.visits.length}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {previews.map((p, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={p.url} alt={p.name} loading="lazy" className="h-12 w-12 rounded-lg border border-(--border-default) object-cover" />
                  ))}
                  <span className="ms-auto flex items-center gap-1 text-xs font-black opacity-60"><Camera size={13} />{photos}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Day detail: every closed client with its photos */}
      <Modal
        open={!!open}
        onClose={() => setOpenKey(null)}
        title={open ? `${open.driver?.name ?? labels.unknown} · ${open.van?.name ?? labels.unknown}` : ""}
        subtitle={open ? open.date.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""}
        icon={<Lock size={18} />}
        width="2xl"
      >
        {open && (
          <div className="space-y-3">
            {[...open.visits].sort((a, b) => a.at.localeCompare(b.at)).map((v) => (
              <div key={v.id} className="space-y-2 rounded-2xl border border-(--border-default) p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black">{v.client.name}</div>
                    <div className="truncate font-mono text-[11px] opacity-60" dir="ltr">{v.client.code}</div>
                  </div>
                  <span className="rounded-full bg-(--bg-sunken) px-2.5 py-0.5 text-xs font-black tabular-nums" dir="ltr">
                    {new Date(v.at).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {v.client.phone && (
                    <a href={`tel:${v.client.phone.replace(/[^+\d]/g, "")}`} aria-label={labels.call} className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white"><Phone size={15} /></a>
                  )}
                  {v.lat != null && v.lng != null && (
                    <a href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noreferrer" aria-label={labels.openMap} className="flex h-9 w-9 items-center justify-center rounded-lg bg-(--brand-500)/10 text-(--brand-600)"><MapPin size={15} /></a>
                  )}
                </div>
                {v.note && <p className="rounded-lg bg-(--bg-sunken) p-2 text-xs font-bold">{labels.note}: {v.note}</p>}
                <div className="flex flex-wrap gap-2">
                  {v.photos.map((_, i) => (
                    <ProductThumb
                      key={i}
                      name={v.client.name}
                      images={[...v.photos.slice(i), ...v.photos.slice(0, i)]}
                      className="h-24 w-24 rounded-xl"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
