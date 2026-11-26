import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { Truck, Warehouse } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { BackButton } from "@/components/ui/BackButton";
import { TransferResolve } from "./TransferResolve";
import { LineQty } from "./LineQty";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, string> = {
  DECLARED: "bg-amber-500/10 text-amber-600",
  CONFIRMED: "bg-emerald-500/10 text-emerald-600",
  REJECTED: "bg-red-500/10 text-red-500",
  CANCELLED: "bg-gray-500/10 text-gray-500",
};

export default async function TransferDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("inventory");
  const row = await prisma.transfer.findFirst({
    where: { id, companyId: session.companyId },
    include: {
      lines: {
        include: {
          product: {
            include: {
              images: { orderBy: { sortOrder: "asc" }, take: 1 },
              conversions: { include: { unit: { select: { name: true } } } },
              baseUnit: { select: { name: true } },
            },
          },
        },
      },
      fromLocation: true,
      toLocation: true,
    },
  });
  if (!row) notFound();
  const statusLabel =
    row.status === "DECLARED" ? t("declared") : row.status === "CONFIRMED" ? t("confirmed") : row.status === "REJECTED" ? t("rejected") : t("cancelled");
  // Resolve rights mirror the API: Admin or owner of the destination van.
  const actor = await prisma.user.findFirst({
    where: { id: session.userId, companyId: session.companyId },
    include: { assignedVans: { select: { id: true } } },
  });
  const canResolve =
    row.status === "DECLARED" &&
    (actor?.role === "Admin" || (row.toLocation.kind === "VAN" && !!actor?.assignedVans.some((v) => v.id === row.toLocationId)));
  // When the viewer cannot resolve, name who must confirm so stock stuck
  // in transit is actionable instead of looking like "quantities don't move".
  const destOwner =
    row.status === "DECLARED" && !canResolve && row.toLocation.kind === "VAN"
      ? await prisma.user.findFirst({
          where: { companyId: session.companyId, isActive: true, assignedVans: { some: { id: row.toLocationId } } },
          select: { fullName: true },
        })
      : null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-5 md:p-6 lg:max-w-4xl xl:max-w-5xl">
      <BackButton fallback={`/${locale}/inventory/transfers`} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-black tabular-nums">{row.number}</h1>
        <span className={cn("rounded-full px-3 py-1 text-xs font-black", STATUS_COLOR[row.status])}>{statusLabel}</span>
      </div>
      <Card>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-(--bg-sunken) px-3 py-2">
            {row.fromLocation.kind === "VAN" ? <Truck size={16} className="shrink-0 text-(--brand-600)" /> : <Warehouse size={16} className="shrink-0 text-(--brand-600)" />}
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase opacity-60">{t("from")}</div>
              <div className="truncate text-sm font-black">{row.fromLocation.name}</div>
            </div>
          </div>
          <span className="shrink-0 font-black opacity-40 rtl:-scale-x-100">→</span>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-(--bg-sunken) px-3 py-2">
            {row.toLocation.kind === "VAN" ? <Truck size={16} className="shrink-0 text-(--brand-600)" /> : <Warehouse size={16} className="shrink-0 text-(--brand-600)" />}
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase opacity-60">{t("to")}</div>
              <div className="truncate text-sm font-black">{row.toLocation.name}</div>
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span><b>{t("cashAmount")}:</b> <span className="tabular-nums">{String(row.cashAmount)}</span></span>
          <span className="opacity-60">{new Date(row.date).toLocaleDateString(locale)}</span>
        </div>
        {row.notes && <div className="mt-1 text-sm opacity-70">{row.notes}</div>}
      </Card>
      <Card>
        <div className="space-y-1.5">
          {row.lines.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-xl bg-(--bg-sunken) px-2 py-1.5">
              {l.product.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.product.images[0].url} alt={l.product.name} className="h-9 w-9 shrink-0 rounded-lg object-cover" loading="lazy" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-overlay) text-sm">📦</span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{l.product.name}</span>
              <span className="shrink-0 text-sm tabular-nums" dir="ltr">
                <LineQty
                  declared={l.declaredQty}
                  confirmed={l.confirmedQty}
                  conversions={l.product.conversions}
                  baseName={l.product.baseUnit?.name ?? ""}
                />
              </span>
            </div>
          ))}
        </div>
      </Card>
      {row.status === "DECLARED" && !canResolve && (
        <Card>
          <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm font-bold text-amber-600">
            ⏳ {t("inTransit")} — {statusLabel}: {destOwner?.fullName ?? "Admin"}
          </div>
        </Card>
      )}
      {canResolve && (
        <TransferResolve
          transferId={row.id}
          lines={JSON.parse(JSON.stringify(row.lines)).map((l: { id: string; declaredQty: unknown; confirmedQty: unknown; product: { name: string; images: Array<{ url: string }>; conversions: Array<{ unitId: string; factor: unknown; unit: { name: string } }>; baseUnit: { name: string } | null } }) => ({
            id: l.id,
            declaredQty: Number(l.declaredQty),
            confirmedQty: l.confirmedQty != null ? Number(l.confirmedQty) : null,
            product: {
              name: l.product.name,
              imageUrl: l.product.images[0]?.url ?? null,
              conversions: l.product.conversions ?? [],
              baseName: l.product.baseUnit?.name ?? "",
            },
          }))}
          labels={{ confirm: t("confirm"), reject: t("reject"), cancel: t("cancel"), queued: t("queued") }}
        />
      )}
    </div>
  );
}
