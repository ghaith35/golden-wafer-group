import { setRequestLocale } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { DocActions } from "@/components/sales/DocActions";
import { BackButton } from "@/components/ui/BackButton";
import { dz } from "@/lib/format";
import { packFactor, lineColis, lineQty, summarize } from "@/lib/transfers/summary";

/// Bon de transfert — the A4 document of a van restock request (depot → van):
/// screen preview + print / PDF / share, same visual language as the delivery
/// note. Opened in a popup (?embed=1) from the requests board, or full page.
type Lang = "fr" | "ar" | "en";

const L = {
  fr: {
    dir: "ltr", title: "BON DE TRANSFERT", sub: "Demande de réapprovisionnement", no: "N°", date: "Date", time: "Heure",
    from: "Départ", to: "Destination", depot: "Dépôt", van: "Camion", driver: "Chauffeur / Livreur", declaredBy: "Demandé par", confirmedBy: "Validé par",
    route: "Trajet", n: "N°", designation: "Désignation", pack: "Colisage", requested: "Demandé", confirmed: "Validé", packs: "Colis", pieces: "Pièces", ref: "Réf.",
    articles: "Articles", totalPacks: "Total colis", totalPieces: "Total pièces", notes: "Observations",
    signDepot: "Magasinier (dépôt)", signDriver: "Chauffeur", signManager: "Responsable", thanks: "Document interne", phone: "Tél",
    DECLARED: "EN ATTENTE", CONFIRMED: "VALIDÉ", REJECTED: "REJETÉ", CANCELLED: "ANNULÉ", empty: "Aucune ligne",
  },
  ar: {
    dir: "rtl", title: "سند تحويل", sub: "طلب تزويد الشاحنة", no: "رقم", date: "التاريخ", time: "الساعة",
    from: "من", to: "إلى", depot: "المستودع", van: "الشاحنة", driver: "السائق / البائع", declaredBy: "طلبه", confirmedBy: "اعتمده",
    route: "المسار", n: "رقم", designation: "المنتج", pack: "التعبئة", requested: "المطلوب", confirmed: "المعتمد", packs: "كراتين", pieces: "قطع", ref: "المرجع",
    articles: "عدد المنتجات", totalPacks: "مجموع الكراتين", totalPieces: "مجموع القطع", notes: "ملاحظات",
    signDepot: "أمين المخزن", signDriver: "السائق", signManager: "المسؤول", thanks: "وثيقة داخلية", phone: "الهاتف",
    DECLARED: "قيد الانتظار", CONFIRMED: "معتمد", REJECTED: "مرفوض", CANCELLED: "ملغى", empty: "لا توجد أسطر",
  },
  en: {
    dir: "ltr", title: "TRANSFER NOTE", sub: "Van restock request", no: "No.", date: "Date", time: "Time",
    from: "From", to: "To", depot: "Depot", van: "Van", driver: "Driver / Seller", declaredBy: "Requested by", confirmedBy: "Approved by",
    route: "Route", n: "No.", designation: "Product", pack: "Pack", requested: "Requested", confirmed: "Approved", packs: "Packs", pieces: "Pieces", ref: "Ref.",
    articles: "Products", totalPacks: "Total packs", totalPieces: "Total pieces", notes: "Notes",
    signDepot: "Storekeeper", signDriver: "Driver", signManager: "Manager", thanks: "Internal document", phone: "Tel",
    DECLARED: "PENDING", CONFIRMED: "APPROVED", REJECTED: "REJECTED", CANCELLED: "CANCELLED", empty: "No lines",
  },
} as const;

const GOLD = "#c9951a";
const INK = "#14100a";
const STAMP: Record<string, string> = { DECLARED: "#b45309", CONFIRMED: "#047857", REJECTED: "#b91c1c", CANCELLED: "#525252" };

export default async function TransferDocPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ lang?: string; embed?: string }>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (session.role !== "Admin") redirect(`/${locale}/livreur`);

  const [tr, company] = await Promise.all([
    prisma.transfer.findFirst({
      where: { id, companyId: session.companyId },
      include: {
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true, matricule: true, user: { select: { fullName: true, phone: true } } } },
        lines: {
          include: {
            product: {
              select: {
                name: true, reference: true, colisage: true,
                images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
                baseUnit: { select: { name: true } },
                conversions: { select: { unitId: true, factor: true, unit: { select: { name: true } } } },
              },
            },
          },
        },
      },
    }),
    prisma.company.findUnique({ where: { id: session.companyId } }),
  ]);
  if (!tr) notFound();
  const people = await prisma.user.findMany({
    where: { id: { in: [tr.declaredById, tr.confirmedById].filter((x): x is string => !!x) } },
    select: { id: true, fullName: true },
  });
  const who = (uid: string | null) => people.find((p) => p.id === uid)?.fullName ?? null;

  const lang: Lang = sp.lang === "ar" || sp.lang === "fr" || sp.lang === "en" ? sp.lang : locale === "ar" || locale === "en" ? locale : "fr";
  const embed = sp.embed === "1";
  const qs = embed ? "&embed=1" : "";
  const T = L[lang];
  const loc = lang === "ar" ? "ar-DZ-u-nu-latn" : lang === "fr" ? "fr-DZ" : "en-GB";
  const d = new Date(tr.date);
  const stampColor = STAMP[tr.status] ?? "#525252";
  const stampText = (T as Record<string, string>)[tr.status] ?? tr.status;

  const rows = tr.lines.map((l, i) => {
    const p = l.product;
    const f = packFactor(p);
    const pk = (p.conversions ?? []).filter((c) => Number(c.factor) > 1).sort((a, b) => Number(a.factor) - Number(b.factor))[0];
    const asked = Number(l.declaredQty);
    const sure = l.confirmedQty != null ? Number(l.confirmedQty) : null;
    return {
      n: i + 1,
      name: p.name,
      ref: p.reference ?? "",
      img: p.images[0]?.url ?? null,
      packLabel: pk ? `${pk.unit.name} = ${dz(f)} ${p.baseUnit?.name ?? ""}` : p.colisage ?? "",
      baseName: p.baseUnit?.name ?? "",
      askedPieces: asked,
      askedPacks: f ? Math.round((asked / f) * 100) / 100 : null,
      surePieces: sure,
      surePacks: sure != null && f ? Math.round((sure / f) * 100) / 100 : null,
      changed: sure != null && Math.abs(sure - asked) > 1e-9,
      lineColis: lineColis({ declaredQty: l.declaredQty, confirmedQty: l.confirmedQty, product: p }),
      lineQty: lineQty({ declaredQty: l.declaredQty, confirmedQty: l.confirmedQty }),
    };
  });
  const showConfirmed = rows.some((r) => r.surePieces != null);
  const sum = summarize(tr.lines.map((l) => ({ declaredQty: l.declaredQty, confirmedQty: l.confirmedQty, product: l.product })));

  const qr = await QRCode.toDataURL(JSON.stringify({ app: "golden-wafer", type: "transfer", n: tr.number }), { margin: 0, width: 220, color: { dark: INK, light: "#ffffff" } }).catch(() => null);
  const logo = company?.logoUrl || "/icons/logo-192.png";
  const dec = who(tr.declaredById);
  const conf = who(tr.confirmedById);

  return (
    <div className="bl-root min-h-screen bg-neutral-200 py-6 print:bg-white print:py-0" dir={T.dir}>
      {/* toolbar (screen only) */}
      <div className="mx-auto mb-4 flex w-[210mm] max-w-full flex-wrap items-center justify-between gap-2 px-2 print:hidden" dir="ltr">
        {embed ? <span /> : <BackButton fallback={`/${locale}/vans/orders`} />}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-white p-0.5 text-xs font-bold shadow">
            {(["fr", "ar", "en"] as const).map((l) => (
              <Link key={l} href={`/${locale}/vans/orders/${id}/doc?lang=${l}${qs}`} className={`rounded-md px-3 py-1.5 ${l === lang ? "text-white" : "text-neutral-600"}`} style={l === lang ? { background: GOLD } : undefined}>
                {l.toUpperCase()}
              </Link>
            ))}
          </div>
          <DocActions lang={lang} fileName={tr.number} />
        </div>
      </div>

      <article className="bl-sheet relative mx-auto w-[210mm] max-w-full overflow-hidden bg-white shadow-2xl print:shadow-none" style={{ color: INK, minHeight: "297mm" }}>
        {/* watermark */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" aria-hidden className="pointer-events-none absolute left-1/2 top-[56%] h-[120mm] w-[120mm] -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.025]" />

        {/* header band */}
        <header className="relative px-[12mm] pb-[7mm] pt-[9mm] text-white" style={{ background: "linear-gradient(135deg, #0b0b0c 0%, #1b1508 70%, #2a1f06 100%)" }}>
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2.2mm]" style={{ background: `linear-gradient(90deg, #f7da7c, ${GOLD}, #a87912)` }} />
          <div className="flex items-center gap-5">
            <span className="flex h-[24mm] w-[24mm] shrink-0 items-center justify-center rounded-2xl bg-white/95 p-1.5 shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt="logo" className="h-full w-full object-contain" />
            </span>
            <div className="min-w-0 flex-1 text-start">
              <div className="text-[22px] font-black leading-tight tracking-tight" style={{ color: "#f6e3a1" }}>{company?.name}</div>
              <div className="mt-1 space-y-0.5 text-[10px] leading-snug text-white/75">
                {company?.address && <div>{company.address}</div>}
                {company?.phone && <div>{T.phone} : <bdi dir="ltr">{company.phone}</bdi></div>}
              </div>
            </div>
            <div className="text-end">
              <div className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: "#f6e3a1" }}>{T.sub}</div>
            </div>
          </div>
        </header>

        <div className="relative px-[12mm] pb-[34mm] pt-[6mm]">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <span className="text-[26px] font-black tracking-tight" style={{ color: "#8f6710" }}>{T.title}</span>
              <span className="ms-4 inline-block text-[15px] font-black">{T.no} : <bdi className="font-mono" dir="ltr">{tr.number}</bdi></span>
            </div>
            <span className="text-[12.5px] font-black">
              {T.date} : <bdi dir="ltr">{d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" })}</bdi>
              <span className="mx-2 text-neutral-300">|</span>
              {T.time} : <bdi dir="ltr">{d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", hour12: false })}</bdi>
            </span>
          </div>
          <div className="mb-4 mt-1 h-[2px] w-24 rounded-full" style={{ background: GOLD }} />

          {/* route cards */}
          <section className="grid grid-cols-[1fr_auto_1fr_auto] items-stretch gap-3">
            <div className="rounded-xl border p-3.5" style={{ borderColor: "#e5e5e5" }}>
              <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: GOLD }}>{T.from} · {T.depot}</div>
              <div className="text-[15px] font-black leading-tight"><bdi dir="auto">{tr.fromLocation?.name ?? "—"}</bdi></div>
              {dec && <div className="mt-1.5 text-[10.5px] text-neutral-700"><span className="text-neutral-500">{T.declaredBy}:</span> <b>{dec}</b></div>}
            </div>
            <div className="flex items-center justify-center text-[22px] font-black" style={{ color: GOLD }} aria-hidden>{T.dir === "rtl" ? "←" : "→"}</div>
            <div className="rounded-xl border p-3.5" style={{ borderColor: "#e6d6a6", background: "linear-gradient(180deg,#fffaf0,#ffffff)" }}>
              <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: GOLD }}>{T.to} · {T.van}</div>
              <div className="text-[15px] font-black leading-tight"><bdi dir="auto">{tr.toLocation?.name ?? "—"}</bdi></div>
              <div className="mt-1.5 space-y-0.5 text-[10.5px] text-neutral-700">
                {tr.toLocation?.matricule && <div><span className="text-neutral-500">{T.van}:</span> <b className="font-mono" dir="ltr">{tr.toLocation.matricule}</b></div>}
                {tr.toLocation?.user && <div><span className="text-neutral-500">{T.driver}:</span> <b>{tr.toLocation.user.fullName}</b>{tr.toLocation.user.phone ? <span dir="ltr"> · {tr.toLocation.user.phone}</span> : null}</div>}
                {conf && <div><span className="text-neutral-500">{T.confirmedBy}:</span> <b>{conf}</b></div>}
              </div>
            </div>
            {qr && (
              <div className="flex flex-col items-center justify-center rounded-xl border p-2.5" style={{ borderColor: "#e5e5e5" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="QR" className="h-[24mm] w-[24mm]" />
                <div className="mt-1 font-mono text-[8px] text-neutral-500" dir="ltr">{tr.number}</div>
              </div>
            )}
          </section>

          {/* lines */}
          <table className="bl-table mt-4 w-full border-collapse text-[10.5px]">
            <thead>
              <tr style={{ background: INK, color: "#f6e3a1" }}>
                <th className="w-[7mm] px-1.5 py-2 text-center text-[9px] font-black">{T.n}</th>
                <th className="w-[13mm] px-1 py-2 text-center text-[9px] font-black" />
                <th className="px-2 py-2 text-start text-[9px] font-black">{T.designation}</th>
                <th className="px-1.5 py-2 text-center text-[9px] font-black">{T.requested} · {T.packs}</th>
                <th className="px-1.5 py-2 text-center text-[9px] font-black">{T.requested} · {T.pieces}</th>
                {showConfirmed && <th className="px-1.5 py-2 text-center text-[9px] font-black">{T.confirmed} · {T.packs}</th>}
                {showConfirmed && <th className="px-1.5 py-2 text-center text-[9px] font-black">{T.confirmed} · {T.pieces}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.n} className="bl-row" style={{ background: i % 2 ? "#fbf7ea" : "#ffffff", borderBottom: "1px solid #eee3c3" }}>
                  <td className="px-1.5 py-1.5 text-center font-bold text-neutral-500">{r.n}</td>
                  <td className="px-1 py-1.5 text-center">
                    {r.img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.img} alt="" className="mx-auto h-[10mm] w-[10mm] rounded-md border object-cover" style={{ borderColor: "#eee3c3" }} />
                    ) : (
                      <span className="mx-auto flex h-[10mm] w-[10mm] items-center justify-center rounded-md border text-[11px] font-black" style={{ borderColor: "#eee3c3", color: GOLD }}>{r.name.trim().charAt(0)}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="text-[11px] font-black leading-tight">{r.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[8.5px] text-neutral-500">
                      {r.ref && <span className="font-mono" dir="ltr">{T.ref} {r.ref}</span>}
                      {r.packLabel && <span style={{ color: "#8f6710" }}>{r.packLabel}</span>}
                    </div>
                  </td>
                  <td className="px-1.5 py-1.5 text-center text-[12px] font-black tabular-nums" dir="ltr">{r.askedPacks !== null ? dz(r.askedPacks) : "—"}</td>
                  <td className="px-1.5 py-1.5 text-center tabular-nums" dir="ltr"><b>{dz(r.askedPieces)}</b> <span className="text-[8px] text-neutral-500">{r.baseName}</span></td>
                  {showConfirmed && (
                    <td className="px-1.5 py-1.5 text-center text-[12px] font-black tabular-nums" dir="ltr" style={r.changed ? { color: "#b45309" } : undefined}>{r.surePacks !== null ? dz(r.surePacks) : "—"}</td>
                  )}
                  {showConfirmed && (
                    <td className="px-1.5 py-1.5 text-center tabular-nums" dir="ltr" style={r.changed ? { color: "#b45309" } : undefined}>
                      {r.surePieces != null ? <><b>{dz(r.surePieces)}</b> <span className="text-[8px] text-neutral-500">{r.baseName}</span></> : "—"}
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={showConfirmed ? 7 : 5} className="py-6 text-center text-neutral-400">{T.empty}</td></tr>}
            </tbody>
          </table>

          {/* totals + notes + stamp */}
          <section className="bl-keep mt-4 grid grid-cols-[1fr_64mm] gap-4">
            <div className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[[T.articles, dz(sum.products)], [T.totalPacks, dz(sum.colis)], [T.totalPieces, dz(sum.pieces)]].map(([k, v]) => (
                  <div key={k} className="rounded-lg border px-2 py-1.5" style={{ borderColor: "#e6d6a6", background: "#fffaf0" }}>
                    <div className="text-[8.5px] font-bold text-neutral-500">{k}</div>
                    <div className="text-[14px] font-black tabular-nums" dir="ltr">{v}</div>
                  </div>
                ))}
              </div>
              {tr.notes && (
                <div className="rounded-lg bg-neutral-50 p-2.5 text-[10px] text-neutral-700"><b>{T.notes}:</b> {tr.notes}</div>
              )}
            </div>
            <div className="flex items-center justify-center">
              <div className="-rotate-6 rounded-lg border-[3px] px-5 py-2 text-center text-[17px] font-black tracking-[0.18em] opacity-85" style={{ borderColor: stampColor, color: stampColor }}>{stampText}</div>
            </div>
          </section>

          {/* signatures */}
          <section className="bl-keep mt-7 grid grid-cols-3 gap-4">
            {[T.signDepot, T.signDriver, T.signManager].map((s) => (
              <div key={s} className="rounded-xl border border-dashed p-2.5" style={{ borderColor: "#d8c58a" }}>
                <div className="text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: GOLD }}>{s}</div>
                <div className="h-[18mm]" />
                <div className="border-t pt-1 text-[8px] text-neutral-400" style={{ borderColor: "#eee3c3" }}>{T.date} : ____ / ____ / ________</div>
              </div>
            ))}
          </section>
        </div>

        <footer className="bl-footer absolute inset-x-0 bottom-0 px-[12mm] pb-[6mm] pt-[3mm] text-[8.5px] text-neutral-500">
          <div className="mb-1.5 h-px" style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />
          <div className="flex items-center justify-between gap-3">
            <span className="font-black" style={{ color: "#8f6710" }}>{T.thanks} ✦ {company?.name}</span>
            <span dir="ltr">{tr.number}</span>
          </div>
        </footer>
      </article>

      {embed && <style>{`header.fixed, .app-sidebar, nav.fixed, div.fixed.inset-x-0.top-0 { display: none !important; } [data-shell-content] { padding: 0 !important; } body { padding: 0 !important; } main { padding: 0 !important; max-width: none !important; } .bl-root { padding-top: 12px !important; min-height: 0 !important; } .gw-watermark { display: none !important; }`}</style>}
      <style>{`
        @page { size: A4; margin: 0; }
        .bl-sheet { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .bl-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .bl-table td { white-space: nowrap; } .bl-table td:nth-child(3) { white-space: normal; }
        .bl-table thead { display: table-header-group; }
        .bl-row, .bl-keep { break-inside: avoid; page-break-inside: avoid; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .bl-sheet { width: 210mm !important; margin: 0 !important; box-shadow: none !important; }
          .bl-footer { position: fixed !important; bottom: 0; }
          .gw-watermark { display: none !important; }
        }
      `}</style>
    </div>
  );
}
