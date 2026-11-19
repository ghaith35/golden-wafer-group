"use client";

import { useEffect, useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { clampPercent, emptyIds, type DIdBlock, type DOptions, type DSeller } from "@/lib/dinvoice";

const T = {
  fr: {
    title: "Bon de route", sub: "Remplissez les informations puis générez le document", docTitle: "Titre du document", remise: "Remise (%)", timbre: "Timbre (%)", tva: "TVA (%)",
    zeroHint: "Laisser vide ou 0 pour masquer la ligne sur le document.", seller: "Vendeur (en-tête)", name: "Nom / SARL", descriptor: "Activité", address: "Adresse", phone: "Tél",
    client: "Client", nb: "NB (note libre)", remembered: "Ces champs sont mémorisés pour le prochain document.", cancel: "Annuler", preview: "Aperçu & impression", edit: "Modifier les informations",
  },
  ar: {
    title: "سند الطريق", sub: "املأ المعلومات ثم أنشئ الوثيقة", docTitle: "عنوان الوثيقة", remise: "التخفيض (%)", timbre: "الطابع (%)", tva: "الرسم TVA (%)",
    zeroHint: "اتركه فارغاً أو 0 لإخفاء السطر من الوثيقة.", seller: "البائع (رأس الوثيقة)", name: "الاسم / الشركة", descriptor: "النشاط", address: "العنوان", phone: "الهاتف",
    client: "الزبون", nb: "ملاحظة (NB)", remembered: "تُحفظ هذه الحقول للوثيقة القادمة.", cancel: "إلغاء", preview: "معاينة وطباعة", edit: "تعديل المعلومات",
  },
  en: {
    title: "Route slip", sub: "Fill in the details, then generate the document", docTitle: "Document title", remise: "Discount (%)", timbre: "Stamp duty (%)", tva: "VAT (%)",
    zeroHint: "Leave empty or 0 to hide the line on the document.", seller: "Seller (header)", name: "Name / company", descriptor: "Activity", address: "Address", phone: "Phone",
    client: "Customer", nb: "NB (free note)", remembered: "These fields are remembered for the next document.", cancel: "Cancel", preview: "Preview & print", edit: "Edit details",
  },
} as const;

const ID_FIELDS: Array<[keyof DIdBlock, string]> = [["rc", "RC"], ["art", "AI"], ["nif", "NIF"], ["nis", "NIS"], ["rib", "RIB"]];
const SELLER_KEY = "gw-bdr-seller";
const clientKey = (k: string) => `gw-bdr-client:${k.trim().toLowerCase()}`;

function load<T extends object>(key: string, defaults: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<T>) } : defaults;
  } catch { return defaults; }
}
function save(key: string, v: object) {
  try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

const emptySeller = (): DSeller => ({ name: "", descriptor: "", address: "", phone: "", ...emptyIds() });

/// "Bon de route" (D-facture flow): a form for the extra fiscal fields, then an
/// embedded A4 preview with print. Seller / client IDs are remembered.
export function BonRouteFlow({
  open, onClose, locale, saleId, saleNumber, client,
}: {
  open: boolean;
  onClose: () => void;
  locale: string;
  saleId: string;
  saleNumber: string;
  client: { code: string; name: string } | null;
}) {
  const t = T[locale === "fr" || locale === "en" ? locale : "ar"];
  const [step, setStep] = useState<"form" | "preview">("form");
  const [docTitle, setDocTitle] = useState("");
  const [remise, setRemise] = useState("");
  const [timbre, setTimbre] = useState("");
  const [tva, setTva] = useState("");
  const [nb, setNb] = useState("");
  const [seller, setSeller] = useState<DSeller>(emptySeller());
  const [cl, setCl] = useState<DIdBlock>(emptyIds());
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setDocTitle((d) => d || (locale === "fr" ? "Bon de route" : locale === "en" ? "Route slip" : "سند الطريق"));
    let on = true;
    (async () => {
      let base = emptySeller();
      try {
        const r = await fetch("/api/settings/company", { cache: "no-store" });
        if (r.ok) {
          const c = await r.json();
          base = { name: c.name ?? "", descriptor: "", address: c.address ?? "", phone: c.phone ?? "", rc: c.rc ?? "", nif: c.nif ?? "", art: c.ai ?? "", nis: c.nis ?? "", rib: c.rib ?? "" };
        }
      } catch { /* offline: keep remembered values only */ }
      if (!on) return;
      // Company settings win; remembered values only fill what settings leave empty.
      const saved = load<DSeller>(SELLER_KEY, emptySeller());
      const merged = { ...saved } as DSeller;
      (Object.keys(base) as Array<keyof DSeller>).forEach((k) => { if (base[k]) merged[k] = base[k]; });
      setSeller(merged);
      setCl(load(clientKey(client?.code ?? client?.name ?? "walkin"), emptyIds()));
    })();
    return () => { on = false; };
  }, [open, client?.code, client?.name, locale]);

  const input = "h-10 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2.5 text-xs font-bold outline-none";
  const lbl = "mb-1 block text-[10px] font-black uppercase text-(--text-tertiary)";

  function generate() {
    save(SELLER_KEY, seller);
    save(clientKey(client?.code ?? client?.name ?? "walkin"), cl);
    const o: DOptions = {
      title: docTitle.trim(),
      remisePercent: clampPercent(Number(remise)),
      timbrePercent: clampPercent(Number(timbre)),
      tvaPercent: clampPercent(Number(tva)),
      nb: nb.trim(),
      seller,
      client: cl,
    };
    setUrl(`/${locale}/sales/${saleId}/bdr?embed=1&d=${encodeURIComponent(JSON.stringify(o))}`);
    setStep("preview");
  }

  return (
    <Modal open={open} onClose={onClose} title={t.title} subtitle={step === "form" ? t.sub : saleNumber} icon="🧾" width={step === "form" ? "lg" : "2xl"}>
      {step === "form" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <label className="col-span-2 block sm:col-span-3">
              <span className={lbl}>{t.docTitle}</span>
              <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} className={input} />
            </label>
            {([[t.remise, remise, setRemise], [t.timbre, timbre, setTimbre], [t.tva, tva, setTva]] as const).map(([l, v, set]) => (
              <label key={l} className="block">
                <span className={lbl}>{l}</span>
                <input type="number" min={0} max={100} step={0.5} inputMode="decimal" placeholder="0" value={v} onChange={(e) => set(e.target.value)} className={input} dir="ltr" />
              </label>
            ))}
            <p className="col-span-2 text-[10.5px] font-bold text-(--text-tertiary) sm:col-span-3">{t.zeroHint}</p>
          </div>

          <div className="rounded-2xl border border-(--border-default) p-3">
            <p className="mb-2 text-[11px] font-black uppercase text-(--gold-text)">{t.seller}</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {([["name", t.name, "col-span-2 sm:col-span-3"], ["descriptor", t.descriptor, "col-span-2 sm:col-span-3"], ["address", t.address, "col-span-2 sm:col-span-2"], ["phone", t.phone, ""]] as Array<[keyof DSeller, string, string]>).map(([k, l, c]) => (
                <label key={k} className={cn("block", c)}>
                  <span className={lbl}>{l}</span>
                  <input value={seller[k]} onChange={(e) => setSeller((s) => ({ ...s, [k]: e.target.value }))} className={input} />
                </label>
              ))}
              {ID_FIELDS.map(([k, l]) => (
                <label key={k} className="block">
                  <span className={lbl}>{l}</span>
                  <input value={seller[k]} onChange={(e) => setSeller((s) => ({ ...s, [k]: e.target.value }))} className={input} dir="ltr" />
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-(--border-default) p-3">
            <p className="mb-2 text-[11px] font-black uppercase text-(--gold-text)">{t.client}{client ? ` — ${client.name}` : ""}</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {ID_FIELDS.map(([k, l]) => (
                <label key={k} className="block">
                  <span className={lbl}>{l}</span>
                  <input value={cl[k]} onChange={(e) => setCl((s) => ({ ...s, [k]: e.target.value }))} className={input} dir="ltr" />
                </label>
              ))}
            </div>
          </div>

          <label className="block">
            <span className={lbl}>{t.nb}</span>
            <input value={nb} onChange={(e) => setNb(e.target.value)} className={input} />
          </label>
          <p className="text-[10.5px] font-bold text-(--text-tertiary)">{t.remembered}</p>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-(--border-default) text-sm font-black text-(--text-secondary) hover:border-(--brand-500)">{t.cancel}</button>
            <button type="button" onClick={generate} className="bg-gradient-brand flex min-h-11 flex-[2] items-center justify-center gap-2 rounded-xl text-sm font-black text-(--brand-contrast)"><Eye size={16} />{t.preview}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button type="button" onClick={() => setStep("form")} className="flex min-h-9 items-center gap-1.5 rounded-lg border border-(--border-default) px-3 text-xs font-black text-(--text-secondary) hover:border-(--brand-500)"><Pencil size={13} />{t.edit}</button>
          <iframe src={url} title={t.title} className="h-[min(74vh,880px)] w-full rounded-xl border border-(--border-default) bg-neutral-200" />
        </div>
      )}
    </Modal>
  );
}
