import { setRequestLocale } from "next-intl/server";
import { FREE_LABEL } from "@/lib/threepack/labels";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { DocActions } from "@/components/sales/DocActions";
import { BackButton } from "@/components/ui/BackButton";
import { dz, dzMoney } from "@/lib/format";
import { amountInWords, type DocLang } from "@/lib/numwords";
import { clampPercent, computeDTotals, emptyIds, type DIdBlock, type DOptions, type DSeller } from "@/lib/dinvoice";

/// Bon de route — fiscal A4 document (Khiata "D facture" information set):
/// seller header + RC/NIF/AI/NIS/RIB, client IDs, Remise / TVA / Timbre, HT → TTC.
const L = {
  fr: { dir: "ltr", def: "BON DE ROUTE", no: "N°", date: "Date", for: "Pour", phone: "Téléphone", address: "Adresse", ref: "Réf.", designation: "Désignation", qty: "Qté", pu: "Prix U", tva: "TVA", totalHt: "Total HT",
    lines: "Nombre de lignes", tvaRate: "TVA", nb: "NB", oldBal: "Ancien solde", remise: "Remise", ht: "Total HT", totTva: "Total TVA", timbre: "Timbre", ttc: "TOTAL TTC", words: "Arrête la présente facture à la somme de",
    foot: "N° {n} le : {d}", page: "Page", print: "Imprimer / PDF", tel: "Tél" },
  ar: { dir: "rtl", def: "سند الطريق", no: "رقم", date: "التاريخ", for: "إلى السيد", phone: "الهاتف", address: "العنوان", ref: "المرجع", designation: "التعيين", qty: "الكمية", pu: "السعر", tva: "الرسم", totalHt: "المبلغ دون الرسم",
    lines: "عدد الأسطر", tvaRate: "نسبة الرسم (TVA)", nb: "ملاحظة", oldBal: "الرصيد السابق", remise: "التخفيض", ht: "المجموع دون الرسم", totTva: "مجموع الرسم", timbre: "الطابع", ttc: "المجموع مع الرسم", words: "أوقفت هذه الوثيقة عند مبلغ",
    foot: "رقم {n} بتاريخ : {d}", page: "صفحة", print: "طباعة / PDF", tel: "الهاتف" },
  en: { dir: "ltr", def: "ROUTE SLIP", no: "No.", date: "Date", for: "To", phone: "Phone", address: "Address", ref: "Ref.", designation: "Description", qty: "Qty", pu: "Unit price", tva: "VAT", totalHt: "Total excl.",
    lines: "Number of lines", tvaRate: "VAT", nb: "NB", oldBal: "Previous balance", remise: "Discount", ht: "Total excl. tax", totTva: "Total VAT", timbre: "Stamp duty", ttc: "TOTAL INCL. TAX", words: "This document is closed at the amount of",
    foot: "No. {n} on : {d}", page: "Page", print: "Print / PDF", tel: "Phone" },
} as const;

const IDL = {
  fr: { rc: "RC", nif: "NIF", art: "AI", nis: "NIS", rib: "RIB" },
  ar: { rc: "السجل التجاري", nif: "رقم التعريف الجبائي", art: "رقم المادة", nis: "رقم التعريف الإحصائي", rib: "الحساب البنكي" },
  en: { rc: "RC", nif: "NIF", art: "AI", nis: "NIS", rib: "RIB" },
} as const;
const GOLD = "#c9951a";
const INK = "#14100a";

function parseOptions(raw: string | undefined): Partial<DOptions> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return typeof o === "object" && o ? (o as Partial<DOptions>) : {};
  } catch {
    return {};
  }
}
const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
const ids = (v: unknown): DIdBlock => {
  const o = (typeof v === "object" && v ? v : {}) as Record<string, unknown>;
  return { rc: str(o.rc), nif: str(o.nif), art: str(o.art), nis: str(o.nis), rib: str(o.rib) };
};

export default async function BonRoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ lang?: string; embed?: string; d?: string }>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const [sale, company, settings] = await Promise.all([
    prisma.sale.findFirst({
      where: { id, companyId: session.companyId },
      include: {
        lines: { include: { product: { select: { name: true, reference: true, baseUnit: { select: { name: true } }, baseUnitId: true, conversions: { select: { unitId: true, unit: { select: { name: true } } } } } } } },
        client: { include: { wilaya: { select: { nameFr: true, nameAr: true } } } },
      },
    }),
    prisma.company.findUnique({ where: { id: session.companyId } }),
    getOrCreateSettings(session.companyId),
  ]);
  if (!sale) notFound();

  const raw = parseOptions(sp.d);
  const lang: DocLang = sp.lang === "ar" || sp.lang === "fr" || sp.lang === "en" ? sp.lang : locale === "ar" || locale === "en" ? locale : "fr";
  const embed = sp.embed === "1";
  const T = L[lang];
  const loc = lang === "ar" ? "ar-DZ-u-nu-latn" : lang === "fr" ? "fr-DZ" : "en-GB";
  const DEFAULTS = ["Bon de route", "Route slip", "سند الطريق", "BON DE ROUTE", "ROUTE SLIP"];
  const custom = str(raw.title);
  const title = custom && !DEFAULTS.includes(custom) ? custom : T.def;
  const remisePercent = clampPercent(Number(raw.remisePercent));
  const timbrePercent = clampPercent(Number(raw.timbrePercent));
  const tvaPercent = clampPercent(Number(raw.tvaPercent));
  const sellerIn = (typeof raw.seller === "object" && raw.seller ? raw.seller : {}) as Partial<DSeller>;
  const seller: DSeller = {
    name: str(sellerIn.name) || (raw.seller ? "" : company?.name ?? ""),
    descriptor: str(sellerIn.descriptor),
    address: str(sellerIn.address),
    phone: str(sellerIn.phone),
    ...(raw.seller ? ids(raw.seller) : { rc: company?.rc ?? "", nif: company?.nif ?? "", art: company?.ai ?? "", nis: company?.nis ?? "", rib: company?.rib ?? "" }),
  };
  const clientIds = raw.client ? ids(raw.client) : emptyIds();
  const nb = str(raw.nb);

  const rows = sale.lines.map((l, i) => {
    const p = l.product;
    const unit = !l.unitId || l.unitId === p.baseUnitId ? p.baseUnit?.name ?? "" : p.conversions.find((c) => c.unitId === l.unitId)?.unit.name ?? p.baseUnit?.name ?? "";
    return { n: i + 1, name: p.name, ref: p.reference ?? "", qty: Number(l.qty), unit, pu: Number(l.unitPrice), total: Number(l.lineTotal), bonus: l.isBonus };
  });
  const totals = computeDTotals(rows.map((r) => r.total), { remisePercent, timbrePercent, tvaPercent });
  const balance = sale.client ? Number(sale.client.balance ?? 0) : 0;
  const prevBalance = Math.max(0, balance - Math.max(0, Number(sale.total) - Number(sale.paid)));
  const d = new Date(sale.date);
  const dateStr = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const compact = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const IL = IDL[lang];
  const sellerIds = (["rc", "nif", "art", "nis", "rib"] as Array<keyof DIdBlock>).filter((k) => seller[k]).map((k) => [IL[k], seller[k]] as const);
  const clientRows = (["rc", "art", "nif", "nis", "rib"] as Array<keyof DIdBlock>).filter((k) => clientIds[k]).map((k) => [k, IL[k]] as const);
  const logo = company?.logoUrl || "/icons/logo-192.png";
  const cur = lang === "ar" ? "دج" : lang === "en" ? "DZD" : "DA";
  const money = (v: number) => dzMoney(Math.round(v * 100) / 100, 2).replace(/ DA/g, `\u00A0${cur}`);
  const num = (v: number) => dz(Math.round(v * 100) / 100, 2);
  const dq = `&d=${encodeURIComponent(sp.d ?? "")}${embed ? "&embed=1" : ""}`;

  return (
    <div className="bl-root min-h-screen bg-neutral-200 py-6 print:bg-white print:py-0" dir={T.dir}>
      <div className="mx-auto mb-4 flex w-[210mm] max-w-full flex-wrap items-center justify-between gap-2 px-2 print:hidden" dir="ltr">
        {embed ? <span /> : <BackButton fallback={`/${locale}/sales/${id}`} />}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-white p-0.5 text-xs font-bold shadow">
            {(["fr", "ar", "en"] as const).map((l) => (
              <Link key={l} href={`/${locale}/sales/${id}/bdr?lang=${l}${dq}`} className={`rounded-md px-3 py-1.5 ${l === lang ? "text-white" : "text-neutral-600"}`} style={l === lang ? { background: GOLD } : undefined}>
                {l.toUpperCase()}
              </Link>
            ))}
          </div>
          <DocActions lang={lang} fileName={`${"BDR"}-${sale.number}`} />
        </div>
      </div>

      <article className="bl-sheet relative mx-auto w-[210mm] max-w-full overflow-hidden bg-white shadow-2xl print:shadow-none" style={{ color: INK, minHeight: "297mm" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" aria-hidden className="pointer-events-none absolute left-1/2 top-[56%] h-[120mm] w-[120mm] -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.025]" />

        <header className="relative px-[12mm] pb-[7mm] pt-[9mm] text-white" style={{ background: "linear-gradient(135deg, #0b0b0c 0%, #1b1508 70%, #2a1f06 100%)" }}>
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2.2mm]" style={{ background: `linear-gradient(90deg, #f7da7c, ${GOLD}, #a87912)` }} />
          <div className="flex items-center gap-5">
            <span className="flex h-[24mm] w-[24mm] shrink-0 items-center justify-center rounded-2xl bg-white/95 p-1.5 shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt="logo" className="h-full w-full object-contain" />
            </span>
            <div className="min-w-0 flex-1 text-start">
              {seller.name && <div className="text-[22px] font-black leading-tight" style={{ color: "#f6e3a1" }}>{seller.name}</div>}
              <div className="mt-1 space-y-0.5 text-[10px] leading-snug text-white/75">
                {seller.descriptor && <div className="font-bold text-white/90">{seller.descriptor}</div>}
                {seller.address && <div>{seller.address}</div>}
                {seller.phone && <div>{T.tel} : <bdi dir="ltr">{seller.phone}</bdi></div>}
                {sellerIds.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-0.5 text-white/65">
                    {sellerIds.map(([l, v]) => <span key={l}>{l} : <bdi dir="ltr">{v}</bdi></span>)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="relative px-[12mm] pb-[28mm] pt-[6mm]">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <span className="text-[26px] font-black tracking-tight" style={{ color: "#8f6710" }}>{title}</span>
              <span className="ms-4 inline-block text-[15px] font-black">{T.no} : <bdi className="font-mono" dir="ltr">{sale.number}</bdi></span>
            </div>
            <span className="text-[13px] font-black">{T.date} : <bdi dir="ltr">{dateStr}</bdi></span>
          </div>
          <div className="mt-1 h-[2px] w-24 rounded-full" style={{ background: GOLD }} />

          <section className="mt-4 flex gap-3.5">
            <div className="flex-[11] rounded-xl border p-3.5" style={{ borderColor: "#e6d6a6", background: "linear-gradient(180deg,#fffaf0,#ffffff)" }}>
              <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: GOLD }}>{T.for}</div>
              <div className="text-[15px] font-black leading-tight"><bdi dir="auto">{sale.client?.name ?? "—"}</bdi></div>
              <div className="mt-1.5 space-y-0.5 text-[10.5px] text-neutral-700">
                <div><span className="text-neutral-500">{T.phone}:</span> <b dir="ltr">{sale.client?.phone ?? "—"}</b></div>
                <div><span className="text-neutral-500">{T.address}:</span> <b>{[sale.client?.address, lang === "ar" ? sale.client?.wilaya?.nameAr : sale.client?.wilaya?.nameFr].filter(Boolean).join(" — ") || "—"}</b></div>
              </div>
            </div>
            {clientRows.length > 0 && (
              <div className="flex-[9] rounded-xl border p-3.5" style={{ borderColor: "#e5e5e5" }}>
                <div className="space-y-1 text-[10.5px]">
                  {clientRows.map(([k, l]) => (
                    <div key={k} className="flex flex-wrap items-baseline gap-x-2"><span className="text-neutral-500">{l} :</span><b className="break-all"><bdi dir="ltr">{clientIds[k]}</bdi></b></div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <table className="bl-table mt-4 w-full table-fixed border-collapse text-[10.5px]">
            <colgroup><col style={{ width: "6%" }} /><col style={{ width: "36%" }} /><col style={{ width: "14%" }} /><col style={{ width: "15%" }} /><col style={{ width: "13%" }} /><col style={{ width: "16%" }} /></colgroup>
            <thead>
              <tr style={{ background: INK, color: "#f6e3a1" }}>
                <th className="px-1.5 px-1.5 py-2 text-center text-[9px] font-black">{T.no}</th>
                <th className="px-2 py-2 text-start text-[9px] font-black">{T.designation}</th>
                <th className="px-1.5 py-2 text-center text-[9px] font-black">{T.qty}</th>
                <th className="px-1.5 py-2 text-end text-[9px] font-black">{T.pu}</th>
                <th className="px-1.5 py-2 text-end text-[9px] font-black">{T.tva}</th>
                <th className="px-2 py-2 text-end text-[9px] font-black">{T.totalHt}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.n} className="bl-row" style={{ background: r.bonus ? "#eef8f0" : i % 2 ? "#fbf7ea" : "#fff", borderBottom: "1px solid #eee3c3" }}>
                  <td className="px-1.5 py-2 text-center font-bold text-neutral-500">{r.n}</td>
                  <td className="px-2 py-2"><div className="text-[11px] font-black leading-tight">{r.name}{r.bonus && <span className="ms-1.5 rounded-full px-1.5 py-px text-[8px] font-black uppercase" style={{ background: "#047857", color: "#fff" }}>★ {FREE_LABEL[lang]}</span>}</div>{r.ref && <div className="font-mono text-[8.5px] text-neutral-500" dir="ltr">{T.ref} {r.ref}</div>}</td>
                  <td className="px-1.5 py-2 text-center tabular-nums" dir="ltr"><b>{num(r.qty)}</b> <span className="text-[8px] text-neutral-500">{r.unit}</span></td>
                  <td className="px-1.5 py-2 text-end tabular-nums" dir="ltr">{money(r.pu)}</td>
                  <td className="px-1.5 py-2 text-end tabular-nums" dir="ltr">{money(totals.lines[i].tva)}</td>
                  <td className="px-2 py-2 text-end text-[11px] font-black tabular-nums" dir="ltr">{money(totals.lines[i].total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="bl-keep mt-4 grid grid-cols-[1fr_76mm] gap-4">
            <div className="space-y-2.5">
              <div className="flex gap-2 text-[10.5px]">
                <div className="rounded-lg border px-3 py-1.5" style={{ borderColor: "#e6d6a6", background: "#fffaf0" }}>{T.lines} : <b>{rows.length}</b></div>
                <div className="rounded-lg border px-3 py-1.5" style={{ borderColor: "#e6d6a6", background: "#fffaf0" }}>{T.tvaRate} : <b dir="ltr">{tvaPercent.toFixed(2)}%</b></div>
              </div>
              <div className="min-h-[10mm] rounded-lg border p-2.5 text-[10.5px]" style={{ borderColor: INK }}>
                <b className="underline">{T.nb} :</b> {[nb, prevBalance > 0 ? `${T.oldBal} : ${money(prevBalance)}` : ""].filter(Boolean).join("  —  ")}
              </div>
              <div className="rounded-lg border border-dashed p-2.5 text-[10.5px] leading-relaxed" style={{ borderColor: GOLD }}>
                <div className="text-[8.5px] font-black uppercase tracking-widest" style={{ color: GOLD }}>{T.words}</div>
                <div className="mt-0.5 font-bold capitalize">{amountInWords(totals.ttc, lang)}</div>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border" style={{ borderColor: "#e6d6a6" }}>
              <div className="space-y-1 p-3 text-[11px]">
                {totals.remise > 0 && <Row k={<>{T.remise} (<bdi dir="ltr">{remisePercent}%</bdi>)</>} v={`− ${money(totals.remise)}`} red />}
                <Row k={T.ht} v={money(totals.netHt)} />
                <Row k={<>{T.totTva} (<bdi dir="ltr">{tvaPercent}%</bdi>)</>} v={money(totals.tva)} />
                {totals.timbre > 0 && <Row k={<>{T.timbre} (<bdi dir="ltr">{timbrePercent}%</bdi>)</>} v={money(totals.timbre)} />}
              </div>
              <div className="flex items-center justify-between gap-2 px-3 py-2.5" style={{ background: "linear-gradient(135deg, #0b0b0c, #2a1f06)", color: "#f6e3a1" }}>
                <span className="text-[9px] font-black tracking-[0.16em]">{T.ttc}</span>
                <span className="text-[16px] font-black tabular-nums" dir="ltr">{money(totals.ttc)}</span>
              </div>
            </div>
          </section>
        </div>

        <footer className="bl-footer absolute inset-x-0 bottom-0 px-[12mm] pb-[6mm] pt-[3mm] text-[8.5px] text-neutral-500">
          <div className="mb-1.5 h-px" style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />
          <div className="flex items-center justify-between gap-3 font-black" style={{ color: "#8f6710" }}>
            <span>{seller.name}</span>
            <span dir="ltr">{T.foot.replace("{n}", sale.number).replace("{d}", compact)}</span>
            <span dir="ltr">1/1</span>
          </div>
        </footer>
      </article>

      {embed && <style>{`header.fixed, .app-sidebar, nav.fixed, div.fixed.inset-x-0.top-0 { display: none !important; } [data-shell-content] { padding: 0 !important; } body { padding: 0 !important; } main { padding: 0 !important; max-width: none !important; } .bl-root { padding-top: 12px !important; min-height: 0 !important; }`}</style>}
      <style>{`
        @page { size: A4; margin: 0; }
        .bl-sheet, .bl-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .bl-table td { white-space: nowrap; } .bl-table td:nth-child(2) { white-space: normal; }
        .bl-table thead { display: table-header-group; }
        .bl-row, .bl-keep { break-inside: avoid; page-break-inside: avoid; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .bl-sheet { width: 210mm !important; margin: 0 !important; box-shadow: none !important; }
          .bl-footer { position: fixed !important; bottom: 0; }
        }
      `}</style>
    </div>
  );
}

function Row({ k, v, red }: { k: React.ReactNode; v: string; red?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 font-bold">
      <span className="text-neutral-600">{k}</span>
      <span className={`tabular-nums ${red ? "text-red-700" : ""}`} dir="ltr">{v}</span>
    </div>
  );
}
