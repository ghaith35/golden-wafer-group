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
import { DashboardClient, type DashAction } from "@/components/dashboard/DashboardClient";
import { buildDashboard, dashboardSince } from "@/lib/dashboard/stats";

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

  if (session.role === "Admin") {
    const since = dashboardSince(now);
    const KINDS = ["DELIVERY", "TICKET"] as ["DELIVERY", "TICKET"];
    const [sales, expenses, vans, clientDebts, supplierDebts, products] = await Promise.all([
      prisma.sale.findMany({
        where: { companyId, kind: { in: KINDS }, status: "DELIVERED", date: { gte: since } },
        select: {
          id: true, number: true, date: true, total: true, paid: true, channel: true, locationId: true, clientId: true,
          client: { select: { name: true } },
          lines: { select: { productId: true, baseQty: true, lineTotal: true, unitCost: true, product: { select: { name: true } } } },
        },
        orderBy: { date: "desc" },
        take: 40000,
      }),
      prisma.expense.findMany({
        where: { companyId, deletedAt: null, expenseDate: { gte: since } },
        select: { amount: true, expenseDate: true, locationId: true },
        take: 20000,
      }),
      prisma.store.findMany({
        where: { companyId, kind: "VAN" },
        select: { id: true, name: true, matricule: true, isActive: true, user: { select: { fullName: true } } },
      }),
      prisma.customer.aggregate({ where: { companyId, balance: { gt: 0 } }, _sum: { balance: true } }),
      prisma.supplier.aggregate({ where: { companyId, balance: { gt: 0 } }, _sum: { balance: true } }),
      prisma.product.findMany({ where: { companyId, isActive: true }, select: { name: true, stockQty: true, minStock: true } }),
    ]);
    const low = products
      .filter((p) => Number(p.stockQty) <= Number(p.minStock))
      .sort((a, b) => Number(a.stockQty) - Number(b.stockQty));
    const data = buildDashboard({
      now,
      sales,
      expenses,
      vans: vans.map((v) => ({ id: v.id, name: v.name, matricule: v.matricule, isActive: v.isActive, driver: v.user?.fullName ?? null })),
    });
    const adminActions: DashAction[] = [
      { href: "pos", label: tn("pos"), icon: "Store", cls: "bg-gradient-brand text-(--brand-contrast)" },
      { href: "sales/tickets/new", label: tn("sales"), icon: "ShoppingCart", cls: "bg-sky-500/15 text-sky-600" },
      { href: "clients", label: tn("clients"), icon: "Users", cls: "bg-emerald-500/15 text-emerald-600" },
      { href: "products", label: tn("inventory"), icon: "Boxes", cls: "bg-violet-500/15 text-violet-500" },
      { href: "inventory/transfers", label: ti("transfers"), icon: "ArrowLeftRight", cls: "bg-amber-500/15 text-amber-600" },
      { href: "expenses", label: tn("expenses"), icon: "Wallet", cls: "bg-red-500/15 text-red-500" },
      { href: "journal", label: tr("journal"), icon: "NotebookPen", cls: "bg-teal-500/15 text-teal-600" },
      { href: "reports", label: tr("title"), icon: "BarChart3", cls: "bg-indigo-500/15 text-indigo-500" },
    ];
    return (
      <DashboardClient
        data={data}
        locale={locale}
        userName={session.username}
        extras={{
          clientDebt: Number(clientDebts._sum.balance ?? 0),
          supplierDebt: Number(supplierDebts._sum.balance ?? 0),
          lowCount: low.length,
          lowList: low.slice(0, 5).map((p) => ({ name: p.name, qty: Number(p.stockQty), min: Number(p.minStock) })),
        }}
        actions={adminActions}
      />
    );
  }

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

  const isAdmin = session.role === "Admin";
  const actions = [
    { href: "pos", label: tn("pos"), Icon: Store, cls: "bg-gradient-brand text-(--brand-contrast)", adminOnly: true },
    { href: "sales/tickets/new", label: tn("sales"), Icon: ShoppingCart, cls: "bg-sky-500/15 text-sky-600", adminOnly: false },
    { href: "clients", label: tn("clients"), Icon: Users, cls: "bg-emerald-500/15 text-emerald-600", adminOnly: false },
    { href: "products", label: tn("inventory"), Icon: Boxes, cls: "bg-violet-500/15 text-violet-500", adminOnly: true },
    { href: "inventory/transfers", label: ti("transfers"), Icon: ArrowLeftRight, cls: "bg-amber-500/15 text-amber-600", adminOnly: true },
    { href: "expenses", label: tn("expenses"), Icon: Wallet, cls: "bg-red-500/15 text-red-500", adminOnly: true },
    { href: "journal", label: tr("journal"), Icon: NotebookPen, cls: "bg-teal-500/15 text-teal-600", adminOnly: true },
    { href: "reports", label: tr("title"), Icon: BarChart3, cls: "bg-indigo-500/15 text-indigo-500", adminOnly: true },
  ].filter((a) => isAdmin || !a.adminOnly);

  return (
    <div className="space-y-5 p-5 md:p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          label={`${t("today")} · ${tr("sales")}`}
          value={fmt(Number(todaySales._sum.total ?? 0))}
          icon={<ShoppingCart size={21} />}
          accent="bg-emerald-500/15 text-emerald-600"
        />
        <KpiCard
          label={`${t("month")} · ${tr("sales")}`}
          value={fmt(monthTotal)}
          icon={<TrendingUp size={21} />}
          accent="bg-sky-500/15 text-sky-600"
        />
        <KpiCard
          label={`${t("month")} · ${t("margin")}`}
          value={fmt(monthTotal - monthCogs)}
          icon={<Percent size={21} />}
          accent="bg-(--brand-500)/15 text-(--brand-600)"
        />
        <KpiCard
          label={t("lowStock")}
          value={String(lowStock)}
          icon={<AlertTriangle size={21} />}
          accent={cn(lowStock > 0 ? "bg-amber-500/15 text-amber-600" : "bg-(--bg-sunken) text-(--text-secondary)")}
          valueClassName={cn(lowStock > 0 && "text-amber-600")}
        />
        <KpiCard
          label={t("clientsOwe")}
          value={fmt(Number(clientDebts._sum.balance ?? 0))}
          icon={<Users size={21} />}
          accent="bg-red-500/15 text-red-500"
          valueClassName={cn(Number(clientDebts._sum.balance ?? 0) > 0 && "text-red-500")}
        />
        <KpiCard
          label={t("weOwe")}
          value={fmt(Number(supplierDebts._sum.balance ?? 0))}
          icon={<Truck size={21} />}
          accent="bg-orange-500/15 text-orange-500"
          valueClassName={cn(Number(supplierDebts._sum.balance ?? 0) > 0 && "text-orange-500")}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {actions.map(({ href, label, Icon, cls }) => (
          <Link
            key={href}
            href={`/${locale}/${href}`}
            className="dash-lift flex flex-col items-center gap-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3.5 text-center transition-all hover:-translate-y-1 hover:border-(--brand-500) hover:shadow-lg active:scale-[0.98]"
          >
            <span className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", cls)}>
              <Icon size={20} />
            </span>
            <span className="text-xs font-black leading-tight">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
