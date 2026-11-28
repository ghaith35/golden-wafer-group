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

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ from?: string; to?: string; vans?: string | string[] }> }) {
  const { locale } = await params;
  const sp = await searchParams;
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
    // Optional custom window (?from=YYYY-MM-DD&to=YYYY-MM-DD), at most one year.
    const okKey = (k?: string) => !!k && /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(new Date(`${k}T00:00:00`).getTime());
    let custom: { from: string; to: string } | null = null;
    if (okKey(sp.from) && okKey(sp.to) && sp.from! <= sp.to!) {
      const days = (new Date(`${sp.to}T00:00:00`).getTime() - new Date(`${sp.from}T00:00:00`).getTime()) / 86_400_000;
      if (days <= 366) custom = { from: sp.from!, to: sp.to! };
    }
    const since = dashboardSince(now, custom);
    const payrollMonth = { year: now.getFullYear(), month: now.getMonth() + 1 };
    const nextMonthStart = new Date(payrollMonth.year, payrollMonth.month, 1);
    const KINDS = ["DELIVERY", "TICKET"] as ["DELIVERY", "TICKET"];
    const allVans = await prisma.store.findMany({
      where: { companyId, kind: "VAN" },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, matricule: true, isActive: true, userId: true, user: { select: { fullName: true } } },
    });
    const requestedVans = new Set(Array.isArray(sp.vans) ? sp.vans : sp.vans ? [sp.vans] : []);
    const selectedVans = allVans.filter((v) => requestedVans.has(v.id));
    const vanIds = selectedVans.map((v) => v.id);
    const locationFilter = vanIds.length ? { locationId: { in: vanIds } } : {};
    const vans = vanIds.length ? selectedVans : allVans;
    const [sales, expenses, clientDebts, supplierDebts, products, employees] = await Promise.all([
      prisma.sale.findMany({
        where: { companyId, kind: { in: KINDS }, status: "DELIVERED", date: { gte: since }, ...locationFilter },
        select: {
          id: true, number: true, date: true, total: true, paid: true, channel: true, locationId: true, clientId: true,
          client: { select: { name: true, gpsLat: true, gpsLng: true } },
          lines: { select: { productId: true, baseQty: true, lineTotal: true, unitCost: true, product: { select: { name: true } } } },
        },
        orderBy: { date: "desc" },
        take: 40000,
      }),
      prisma.expense.findMany({
        where: { companyId, deletedAt: null, expenseDate: { gte: since }, ...locationFilter },
        select: { amount: true, expenseDate: true, locationId: true },
        take: 20000,
      }),
      prisma.customer.aggregate({ where: { companyId, balance: { gt: 0 } }, _sum: { balance: true } }),
      prisma.supplier.aggregate({ where: { companyId, balance: { gt: 0 } }, _sum: { balance: true } }),
      prisma.product.findMany({ where: { companyId, isActive: true }, select: { name: true, stockQty: true, minStock: true } }),
      prisma.employee.findMany({
        where: {
          companyId,
          OR: [
            {
              isActive: true,
              hireDate: { lt: nextMonthStart },
              OR: [{ endDate: null }, { endDate: { gte: monthStart } }],
            },
            { payslips: { some: payrollMonth } },
          ],
        },
        select: {
          userId: true,
          salary: true,
          payslips: { where: payrollMonth, select: { baseSalary: true } },
        },
      }),
    ]);
    const low = products
      .filter((p) => Number(p.stockQty) <= Number(p.minStock))
      .sort((a, b) => Number(a.stockQty) - Number(b.stockQty));
    const salaryByUser = new Map(employees.map((e) => [e.userId, Number(e.payslips[0]?.baseSalary ?? e.salary)]));
    const selectedDrivers = new Set(selectedVans.map((v) => v.userId));
    const monthlySalary = [...salaryByUser].reduce((sum, [userId, salary]) =>
      sum + (!vanIds.length || selectedDrivers.has(userId) ? salary : 0), 0);
    const data = buildDashboard({
      now,
      custom,
      sales,
      expenses,
      monthlySalary,
      showAllProvidedVans: vanIds.length > 0,
      vans: vans.map((v) => ({
        id: v.id, name: v.name, matricule: v.matricule, isActive: v.isActive,
        driver: v.user?.fullName ?? null,
        monthlySalary: v.userId ? salaryByUser.get(v.userId) ?? 0 : 0,
      })),
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
        vanOptions={allVans.map(({ id, name }) => ({ id, name }))}
        selectedVanIds={vanIds}
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
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3 lg:grid-cols-3">
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

      <div className="grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-2 sm:grid-cols-4 lg:grid-cols-8">
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
