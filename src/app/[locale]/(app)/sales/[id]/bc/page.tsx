import { setRequestLocale } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { PrintButton } from "@/components/ui/PrintButton";
import { BackButton } from "@/components/ui/BackButton";
import { dz, dzMoney } from "@/lib/format";
import { amountInWords, type DocLang } from "@/lib/numwords";

/// Bon de commande — premium A4 order sheet: customer, assigned van, products
/// with photos, depot availability and a preparation checklist.
const L = {
  fr: { dir: "ltr", title: "BON DE COMMANDE", no: "N°", date: "Date", time: "Heure", client: "Client", code: "Code client", phone: "Tél", address: "Adresse", order: "Commande", van: "Camion assigné", seller: "Saisi par", tier: "Tarif", status: "Statut",
    st: { DRAFT: "BROUILLON", CONFIRMED: "CONFIRMÉE", DELIVERED: "LIVRÉE", INVOICED: "FACTURÉE", CANCELLED: "ANNULÉE" } as Record<string, string>,
    n: "N°", photo: "Photo", designation: "Désignation", packs: "Colis", pieces: "Pièces", puPiece: "P.U pièce", puPack: "P.U colis", amount: "Montant", prep: "Préparé", depot: "Dispo dépôt", ok: "Disponible", short: "Manque",
    articles: "Articles", totalPacks: "Total colis", totalPieces: "Total pièces", subtotal: "Sous-total", discount: "Remise", total: "TOTAL COMMANDE", paid: "Acompte", rest: "Reste à payer", oldBal: "Ancien solde", newBal: "Solde après commande",
    words: "Arrêtée la présente commande à la somme de", notes: "Observations", thanks: "Merci de votre confiance", print: "Imprimer / PDF", ref: "Réf.", tel: "Tél", prepTitle: "Préparation", prepHint: "Cochez chaque ligne après préparation du colis" },
  ar: { dir: "rtl", title: "سند طلبية", no: "رقم", date: "التاريخ", time: "الساعة", client: "الزبون", code: "رمز الزبون", phone: "الهاتف", address: "العنوان", order: "الطلبية", van: "الشاحنة المخصصة", seller: "أُدخلت بواسطة", tier: "فئة السعر", status: "الحالة",
    st: { DRAFT: "مسودة", CONFIRMED: "مؤكَّدة", DELIVERED: "موصَّلة", INVOICED: "مفوتَرة", CANCELLED: "ملغاة" } as Record<string, string>,
    n: "#", photo: "الصورة", designation: "التعيين", packs: "الكراتين", pieces: "القطع", puPiece: "سعر القطعة", puPack: "سعر الكرتون", amount: "المبلغ", prep: "تم التحضير", depot: "متوفر بالمخزن", ok: "متوفر", short: "ناقص",
    articles: "الأصناف", totalPacks: "مجموع الكراتين", totalPieces: "مجموع القطع", subtotal: "المجموع الجزئي", discount: "التخفيض", total: "إجمالي الطلبية", paid: "العربون", rest: "المتبقي للدفع", oldBal: "الرصيد السابق", newBal: "الرصيد بعد الطلبية",
    words: "أوقفت هذه الطلبية عند مبلغ", notes: "ملاحظات", thanks: "شكراً لثقتكم", print: "طباعة / PDF", ref: "المرجع", tel: "الهاتف", prepTitle: "التحضير", prepHint: "ضع علامة على كل سطر بعد تحضير الكراتين" },
  en: { dir: "ltr", title: "ORDER FORM", no: "No.", date: "Date", time: "Time", client: "Customer", code: "Customer code", phone: "Phone", address: "Address", order: "Order", van: "Assigned van", seller: "Entered by", tier: "Price tier", status: "Status",
    st: { DRAFT: "DRAFT", CONFIRMED: "CONFIRMED", DELIVERED: "DELIVERED", INVOICED: "INVOICED", CANCELLED: "CANCELLED" } as Record<string, string>,
    n: "#", photo: "Photo", designation: "Description", packs: "Packs", pieces: "Pieces", puPiece: "Unit price", puPack: "Pack price", amount: "Amount", prep: "Prepared", depot: "In depot", ok: "In stock", short: "Short",
    articles: "Items", totalPacks: "Total packs", totalPieces: "Total pieces", subtotal: "Subtotal", discount: "Discount", total: "ORDER TOTAL", paid: "Deposit", rest: "Balance due", oldBal: "Previous balance", newBal: "Balance after order",
    words: "This order is closed at the amount of", notes: "Notes", thanks: "Thank you for your trust", print: "Print / PDF", ref: "Ref.", tel: "Phone", prepTitle: "Preparation", prepHint: "Tick each line once its packs are prepared" },
} as const;

const GOLD = "#c9951a";
const INK = "#14100a";

export default async function OrderSheetPage({
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
  const [sale, company, depot] = await Promise.all([
    prisma.sale.findFirst({
      where: { id, companyId: session.companyId },
      include: {
        lines: {
          include: {
            product: {
              select: {
                name: true, reference: true, colisage: true,
                baseUnit: { select: { name: true } },
                conversions: { select: { factor: true, unit: { select: { name: true } } } },
                images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
              },
            },
          },
        },
        client: { include: { wilaya: { select: { nameFr: true, nameAr: true } } } },
        location: true,
        tier: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
    }),
    prisma.company.findUnique({ where: { id: session.companyId } }),
    prisma.store.findFirst({ where: { companyId: session.companyId, kind: "DEPOT" }, orderBy: { createdAt: "asc" }, select: { id: true } }),
  ]);
  if (!sale) notFound();
  const avail = new Map<string, number>();
  if (depot) {
    const g = await prisma.stockBatch.groupBy({
      by: ["productId"],
      where: { companyId: session.companyId, storeId: depot.id, transferId: null, qty: { gt: 0 }, productId: { in: sale.lines.map((l) => l.productId) } },
      _sum: { qty: true },
    });
    for (const x of g) avail.set(x.productId, Number(x._sum.qty ?? 0));
  }

  const lang: DocLang = sp.lang === "ar" || sp.lang === "fr" || sp.lang === "en" ? sp.lang : locale === "ar" || locale === "en" ? locale : "fr";
  const embed = sp.embed === "1";
  const qs = embed ? "&embed=1" : "";
  const T = L[lang];
  const loc = lang === "ar" ? "ar-DZ-u-nu-latn" : lang === "fr" ? "fr-DZ" : "en-GB";
  const total = Number(sale.total);
  const paid = Number(sale.paid);
  const due = Math.max(0, total - paid);
  const remise = Number(sale.remise ?? 0);
  const linesSum = sale.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
  const balance = sale.client ? Number(sale.client.balance ?? 0) : null;
  const d = new Date(sale.date);
  const stampColor = sale.status === "CANCELLED" ? "#b91c1c" : sale.status === "DRAFT" ? "#6b7280" : sale.status === "CONFIRMED" ? GOLD : "#047857";
  const cur = lang === "ar" ? "دج" : lang === "en" ? "DZD" : "DA";
  const money = (v: number) => dzMoney(Math.round(v * 100) / 100, 2).replace(/ DA/g, ` ${cur}`);
  const FL = lang === "ar" ? { rc: "السجل التجاري", nif: "رقم التعريف الجبائي", ai: "رقم المادة", nis: "رقم التعريف الإحصائي" } : { rc: "RC", nif: "NIF", ai: "AI", nis: "NIS" };
  const fiscal = ([[FL.rc, company?.rc], [FL.nif, company?.nif], [FL.ai, company?.ai], [FL.nis, company?.nis]] as Array<[string, string | null | undefined]>).filter(([, v]) => v);
  const logo = company?.logoUrl || "/icons/logo-192.png";

  const rows = sale.lines.map((l, i) => {
    const p = l.product;
    const base = Number(l.baseQty ?? l.qty);
    const pack = (p.conversions ?? []).filter((c) => Number(c.factor) > 1).sort((a, b) => Number(a.factor) - Number(b.factor))[0];
    const packF = pack ? Number(pack.factor) : 0;
    const gross = Number(l.lineTotal) + Number(l.remise ?? 0);
    const pPiece = base > 0 ? gross / base : Number(l.unitPrice);
    const have = avail.get(l.productId);
    return {
      n: i + 1, name: p.name, ref: p.reference ?? "", img: p.images[0]?.url ?? null,
      packLabel: packF ? `${pack!.unit.name} = ${dz(packF)} ${p.baseUnit?.name ?? ""}` : p.colisage ?? "",
      packQty: packF ? Math.round((base / packF) * 100) / 100 : null, base, baseName: p.baseUnit?.name ?? "",
      pPiece, pPack: packF ? pPiece * packF : null, amount: Number(l.lineTotal),
      haveText: have === undefined ? null : packF ? `${dz(Math.round((have / packF) * 100) / 100)} ${pack!.unit.name}` : `${dz(have)} ${p.baseUnit?.name ?? ""}`,
      short: have !== undefined && have + 1e-9 < base,
    };
  });
  const totalPacks = rows.reduce((s, r) => s + (r.packQty ?? 0), 0);
  const totalPieces = rows.reduce((s, r) => s + r.base, 0);
  const anyShort = rows.some((r) => r.short);
  const qr = await QRCode.toDataURL(JSON.stringify({ app: "golden-wafer", type: "order", n: sale.number, t: total }), { margin: 0, width: 220, color: { dark: INK, light: "#ffffff" } }).catch(() => null);

  return (
    <div className="bl-root min-h-screen bg-neutral-200 py-6 print:bg-white print:py-0" dir={T.dir}>
      <div className="mx-auto mb-4 flex w-[210mm] max-w-full flex-wrap items-center justify-between gap-2 px-2 print:hidden" dir="ltr">
        {embed ? <span /> : <BackButton fallback={`/${locale}/sales/${id}`} />}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-white p-0.5 text-xs font-bold shadow">
            {(["fr", "ar", "en"] as const).map((l) => (
              <Link key={l} href={`/${locale}/sales/${id}/bc?lang=${l}${qs}`} className={`rounded-md px-3 py-1.5 ${l === lang ? "text-white" : "text-neutral-600"}`} style={l === lang ? { background: GOLD } : undefined}>
                {l.toUpperCase()}
              </Link>
            ))}
          </div>
          <PrintButton label={`🖨 ${T.print}`} className="rounded-lg bg-[#c9951a] px-4 py-2 text-sm font-black text-white shadow" />
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
              <div className="text-[22px] font-black leading-tight tracking-tight" style={{ color: "#f6e3a1" }}>{company?.name}</div>
              <div className="mt-1 space-y-0.5 text-[10px] leading-snug text-white/75">
                {company?.address && <div>{company.address}</div>}
                <div className="flex flex-wrap gap-x-3">
                  {company?.phone && <span>{T.tel} : <bdi dir="ltr">{company.phone}</bdi></span>}
                  {company?.email && <bdi dir="ltr">{company.email}</bdi>}
                </div>
                {fiscal.length > 0 && <div className="flex flex-wrap gap-x-4 text-white/60">{fiscal.map(([l, v]) => <span key={l}>{l} : <bdi dir="ltr">{v}</bdi></span>)}</div>}
              </div>
            </div>
          </div>
        </header>

        <div className="relative px-[12mm] pb-[28mm] pt-[6mm]">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <span className="text-[26px] font-black tracking-tight" style={{ color: "#8f6710" }}>{T.title}</span>
              <span className="ms-4 inline-block text-[15px] font-black">{T.no} : <bdi className="font-mono" dir="ltr">{sale.number}</bdi></span>
            </div>
            <span className="text-[12.5px] font-black">
              {T.date} : <bdi dir="ltr">{d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" })}</bdi>
              <span className="mx-2 text-neutral-300">|</span>
              {T.time} : <bdi dir="ltr">{d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", hour12: false })}</bdi>
            </span>
          </div>
          <div className="mb-4 mt-1 h-[2px] w-24 rounded-full" style={{ background: GOLD }} />

          <section className="grid grid-cols-[1.25fr_1fr_auto] gap-3.5">
            <div className="rounded-xl border p-3.5" style={{ borderColor: "#e6d6a6", background: "linear-gradient(180deg,#fffaf0,#ffffff)" }}>
              <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: GOLD }}>{T.client}</div>
              <div className="text-[15px] font-black leading-tight">{sale.client?.name ?? "—"}</div>
              {sale.client && (
                <div className="mt-1.5 space-y-0.5 text-[10.5px] text-neutral-700">
                  <div><span className="text-neutral-500">{T.code}:</span> <b className="font-mono" dir="ltr">{sale.client.code}</b></div>
                  {sale.client.phone && <div><span className="text-neutral-500">{T.phone}:</span> <b dir="ltr">{sale.client.phone}</b></div>}
                  {(sale.client.address || sale.client.wilaya) && <div><span className="text-neutral-500">{T.address}:</span> {[sale.client.address, lang === "ar" ? sale.client.wilaya?.nameAr : sale.client.wilaya?.nameFr].filter(Boolean).join(" — ")}</div>}
                </div>
              )}
            </div>
            <div className="rounded-xl border p-3.5" style={{ borderColor: "#e5e5e5" }}>
              <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: GOLD }}>{T.order}</div>
              <div className="space-y-0.5 text-[10.5px] text-neutral-700">
                <div className="flex items-center gap-1.5"><span className="text-neutral-500">{T.status}:</span> <b className="rounded-full px-2 py-px text-[9.5px] text-white" style={{ background: stampColor }}>{T.st[sale.status] ?? sale.status}</b></div>
                {sale.location && <div><span className="text-neutral-500">{T.van}:</span> <b>{sale.location.name}{sale.location.matricule ? ` · ${sale.location.matricule}` : ""}</b></div>}
                {sale.createdBy && <div><span className="text-neutral-500">{T.seller}:</span> <b>{sale.createdBy.fullName}</b></div>}
                {sale.tier?.name && <div><span className="text-neutral-500">{T.tier}:</span> <b>{sale.tier.name}</b></div>}
              </div>
            </div>
            {qr && (
              <div className="flex flex-col items-center justify-center rounded-xl border p-2.5" style={{ borderColor: "#e5e5e5" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="QR" className="h-[24mm] w-[24mm]" />
                <div className="mt-1 font-mono text-[8px] text-neutral-500" dir="ltr">{sale.number}</div>
              </div>
            )}
          </section>

          <table className="bl-table mt-4 w-full table-fixed border-collapse text-[10.5px]">
            <colgroup>
              <col style={{ width: "5%" }} /><col style={{ width: "10%" }} /><col style={{ width: "30%" }} /><col style={{ width: "9%" }} /><col style={{ width: "10%" }} /><col style={{ width: "13%" }} /><col style={{ width: "15%" }} /><col style={{ width: "8%" }} />
            </colgroup>
            <thead>
              <tr style={{ background: INK, color: "#f6e3a1" }}>
                <th className="px-1 py-2 text-center text-[9px] font-black">{T.n}</th>
                <th className="px-1 py-2 text-center text-[9px] font-black">{T.photo}</th>
                <th className="px-2 py-2 text-start text-[9px] font-black">{T.designation}</th>
                <th className="px-1 py-2 text-center text-[9px] font-black">{T.packs}</th>
                <th className="px-1 py-2 text-center text-[9px] font-black">{T.pieces}</th>
                <th className="px-1.5 py-2 text-end text-[9px] font-black">{T.puPack}</th>
                <th className="px-2 py-2 text-end text-[9px] font-black">{T.amount}</th>
                <th className="px-1 py-2 text-center text-[9px] font-black">{T.prep}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.n} className="bl-row" style={{ background: i % 2 ? "#fbf7ea" : "#fff", borderBottom: "1px solid #eee3c3" }}>
                  <td className="px-1 py-2 text-center font-bold text-neutral-500">{r.n}</td>
                  <td className="px-1 py-1.5 text-center">
                    {r.img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.img} alt="" className="mx-auto h-[12mm] w-[12mm] rounded-lg object-cover" style={{ border: "1px solid #eee3c3" }} />
                    ) : (
                      <span className="mx-auto flex h-[12mm] w-[12mm] items-center justify-center rounded-lg bg-neutral-100 text-[14px]">📦</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="text-[11px] font-black leading-tight">{r.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[8.5px] text-neutral-500">
                      {r.ref && <span className="font-mono" dir="ltr">{T.ref} {r.ref}</span>}
                      {r.packLabel && <span style={{ color: "#8f6710" }}>{r.packLabel}</span>}
                    </div>
                  </td>
                  <td className="px-1 py-2 text-center text-[13px] font-black tabular-nums" dir="ltr">{r.packQty !== null ? dz(r.packQty) : "—"}</td>
                  <td className="px-1 py-2 text-center tabular-nums" dir="ltr"><b>{dz(r.base)}</b> <span className="text-[8px] text-neutral-500">{r.baseName}</span></td>
                  <td className="px-1.5 py-2 text-end tabular-nums" dir="ltr">{r.pPack !== null ? money(r.pPack) : money(r.pPiece)}</td>
                  <td className="px-2 py-2 text-end text-[11px] font-black tabular-nums" dir="ltr">{money(r.amount)}</td>
                  <td className="px-1 py-2 text-center"><span className="inline-block h-[5mm] w-[5mm] rounded-[1.2mm] border-[1.5px]" style={{ borderColor: INK }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[8.5px] text-neutral-500">☐ {T.prepHint}</div>

          <section className="bl-keep mt-4 grid grid-cols-[1fr_72mm] gap-4">
            <div className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[[T.articles, dz(rows.length)], [T.totalPacks, dz(totalPacks)], [T.totalPieces, dz(totalPieces)]].map(([k, v]) => (
                  <div key={k} className="rounded-lg border px-2 py-1.5" style={{ borderColor: "#e6d6a6", background: "#fffaf0" }}>
                    <div className="text-[8.5px] font-bold text-neutral-500">{k}</div>
                    <div className="text-[14px] font-black tabular-nums" dir="ltr">{v}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-dashed p-2.5 text-[10.5px] leading-relaxed" style={{ borderColor: GOLD }}>
                <div className="text-[8.5px] font-black uppercase tracking-widest" style={{ color: GOLD }}>{T.words}</div>
                <div className="mt-0.5 font-bold capitalize">{amountInWords(total, lang)}</div>
              </div>
              {sale.notes && sale.notes !== "DEMO" && (
                <div className="rounded-lg bg-neutral-50 p-2.5 text-[10px] text-neutral-700"><b>{T.notes}:</b> {sale.notes}</div>
              )}
            </div>
            <div className="overflow-hidden rounded-xl border" style={{ borderColor: "#e6d6a6" }}>
              <div className="space-y-1 p-3 text-[11px]">
                <Row k={T.subtotal} v={money(linesSum)} />
                {remise > 0 && <Row k={T.discount} v={`− ${money(remise)}`} red />}
                <Row k={T.paid} v={money(paid)} green />
                {due > 0.005 && <Row k={T.rest} v={money(due)} red bold />}
                {balance !== null && (
                  <div className="mt-1.5 space-y-0.5 border-t border-dashed pt-1.5 text-[9.5px] text-neutral-500" style={{ borderColor: "#e6d6a6" }}>
                    <Row k={T.oldBal} v={money(balance)} small />
                    <Row k={T.newBal} v={money(balance + due)} small />
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-3 py-2.5" style={{ background: "linear-gradient(135deg, #0b0b0c, #2a1f06)", color: "#f6e3a1" }}>
                <span className="text-[9px] font-black tracking-[0.16em]">{T.total}</span>
                <span className="text-[16px] font-black tabular-nums" dir="ltr">{money(total)}</span>
              </div>
            </div>
          </section>
        </div>

        <footer className="bl-footer absolute inset-x-0 bottom-0 px-[12mm] pb-[6mm] pt-[3mm] text-[8.5px] text-neutral-500">
          <div className="mb-1.5 h-px" style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />
          <div className="flex items-center justify-between gap-3">
            <span className="font-black" style={{ color: "#8f6710" }}>{T.thanks} ✦ {company?.name}</span>
            <span dir="ltr">{sale.number}</span>
          </div>
        </footer>
      </article>

      {embed && <style>{`header.fixed, .app-sidebar, nav.fixed, div.fixed.inset-x-0.top-0 { display: none !important; } [data-shell-content] { padding: 0 !important; } body { padding: 0 !important; } main { padding: 0 !important; max-width: none !important; } .bl-root { padding-top: 12px !important; min-height: 0 !important; }`}</style>}
      <style>{`
        @page { size: A4; margin: 0; }
        .bl-sheet, .bl-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .bl-table td { white-space: nowrap; } .bl-table td:nth-child(3) { white-space: normal; }
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

function Row({ k, v, red, green, bold, small }: { k: string; v: string; red?: boolean; green?: boolean; bold?: boolean; small?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${small ? "text-[9.5px]" : ""} ${bold ? "font-black" : "font-bold"}`}>
      <span className="text-neutral-600">{k}</span>
      <span className={`tabular-nums ${red ? "text-red-700" : green ? "text-emerald-700" : ""}`} dir="ltr">{v}</span>
    </div>
  );
}
