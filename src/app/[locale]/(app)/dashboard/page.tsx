import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { KpiCard } from "@/components/ui/Card";
import { dzMoney } from "@/lib/format";
import {
  AlertTriangle, ArrowLeftRight, BarChart3, Boxes, NotebookPen,
  Percent, ShoppingCart, Store, TrendingUp, Truck, Users, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (v: number) => dzMoney(v);

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("dashboard");
  const tr = await getTranslations("reports");
  const tn = await getTranslations("nav");
  const ti = await getTranslations("inventory");
  const companyId = session.companyId;
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todaySales, monthSales, clientDebts, supplierDebts] = await Promise.all([
    prisma.sale.aggregate({
      where: { companyId, kind: { in: ["DELIVERY", "TICKET"] }, status: "DELIVERED", date: { gte: dayStart } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.findMany({
      where: { companyId, kind: { in: ["DELIVERY", "TICKET"] }, status: "DELIVERED", date: { gte: monthStart } },
      select: { total: true, locationId: true, lines: { select: { baseQty: true, unitCost: true } } },
    }),
    prisma.customer.aggregate({ where: { companyId, balance: { gt: 0 } }, _sum: { balance: true } }),
    prisma.supplier.aggregate({ where: { companyId, balance: { gt: 0 } }, _sum: { balance: true } }),
  ]);

  const monthTotal = monthSales.reduce((s, x) => s + Number(x.total), 0);
  const monthCogs = monthSales.reduce((s, x) => s + x.lines.reduce((a, l) => a + Number(l.baseQty) * Number(l.unitCost), 0), 0);

  const lowStock = await prisma.product.findMany({ where: { companyId, isActive: true }, select: { stockQty: true, minStock: true } })
    .then((rows) => rows.filter((p) => Number(p.stockQty) <= Number(p.minStock)).length);

  const actions = [
    { href: "pos", label: tn("pos"), Icon: Store, cls: "bg-gradient-brand text-white" },
    { href: "sales/tickets/new", label: tn("sales"), Icon: ShoppingCart, cls: "bg-sky-500/15 text-sky-600" },
    { href: "clients", label: tn("clients"), Icon: Users, cls: "bg-emerald-500/15 text-emerald-600" },
    { href: "products", label: tn("inventory"), Icon: Boxes, cls: "bg-violet-500/15 text-violet-500" },
    { href: "inventory/transfers", label: ti("transfers"), Icon: ArrowLeftRight, cls: "bg-amber-500/15 text-amber-600" },
    { href: "expenses", label: tn("expenses"), Icon: Wallet, cls: "bg-red-500/15 text-red-500" },
    { href: "journal", label: tr("journal"), Icon: NotebookPen, cls: "bg-teal-500/15 text-teal-600" },
    { href: "reports", label: tr("title"), Icon: BarChart3, cls: "bg-indigo-500/15 text-indigo-500" },
  ];

  return (
    <div className="space-y-5 p-5 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-black">{t("title")}</h1>
          <p className="text-xs font-semibold opacity-60">
            {now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          label={`${t("today")} · ${tr("sales")}`}
          value={fmt(Number(todaySales._sum.total ?? 0))}
          icon={<ShoppingCart size={20} />}
          accent="bg-emerald-500/15 text-emerald-600"
        />
        <KpiCard
          label={`${t("month")} · ${tr("sales")}`}
          value={fmt(monthTotal)}
          icon={<TrendingUp size={20} />}
          accent="bg-sky-500/15 text-sky-600"
        />
        <KpiCard
          label={`${t("month")} · ${t("margin")}`}
          value={fmt(monthTotal - monthCogs)}
          icon={<Percent size={20} />}
          accent="bg-gradient-brand text-white"
        />
        <KpiCard
          label={t("lowStock")}
          value={String(lowStock)}
          icon={<AlertTriangle size={20} />}
          accent={cn(lowStock > 0 ? "bg-amber-500/15 text-amber-600" : "bg-(--bg-sunken) text-(--text-secondary)")}
        />
        <KpiCard
          label={t("clientsOwe")}
          value={fmt(Number(clientDebts._sum.balance ?? 0))}
          icon={<Users size={20} />}
          accent="bg-red-500/15 text-red-500"
        />
        <KpiCard
          label={t("weOwe")}
          value={fmt(Number(supplierDebts._sum.balance ?? 0))}
          icon={<Truck size={20} />}
          accent="bg-orange-500/15 text-orange-500"
        />
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {actions.map(({ href, label, Icon, cls }) => (
          <Link
            key={href}
            href={`/${locale}/${href}`}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-(--brand-500) hover:shadow-md"
          >
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", cls)}>
              <Icon size={19} />
            </span>
            <span className="text-[11px] font-bold leading-tight">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
