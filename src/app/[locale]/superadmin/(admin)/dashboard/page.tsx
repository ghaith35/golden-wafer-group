import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";

export default async function SuperAdminDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("superadmin");

  const [companies, totalUsers, totalStores, totalMachines, byStatus, trialsExpiring, poolKeys] = await Promise.all([
    prisma.company.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.store.count({ where: { isActive: true } }),
    prisma.machine.count(),
    prisma.machine.groupBy({ by: ["status"], _count: true }),
    prisma.machine.count({
      where: { status: { not: "revoked" }, trialEnd: { gt: new Date(), lt: new Date(Date.now() + 7 * 86400000) } },
    }),
    prisma.licenseKey.count({ where: { revoked: false, machineId: null, consumedByMachineId: null } }),
  ]);
  const count = (s: string) => byStatus.find((x) => x.status === s)?._count ?? 0;

  const stats = [
    { label: t("statCompanies"), value: companies, sub: t("statMachinesSub", { count: String(totalMachines) }) },
    { label: t("statUsers"), value: totalUsers, sub: t("statActive") },
    { label: t("statStores"), value: totalStores, sub: t("statAcrossCompanies") },
    { label: t("statMachines"), value: totalMachines, sub: t("statActiveCount", { count: String(count("activated")) }) },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-lg font-bold tracking-tight text-(--text-primary) sm:text-xl">{t("dashboard")}</h1>
        <p className="mt-0.5 text-xs text-(--text-secondary) sm:text-sm">{t("dashSubtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="rounded-2xl border border-(--border-default) border-t-2 bg-(--bg-overlay) p-4 shadow-sm sm:p-5"
            style={{ borderTopColor: ["#6366f1", "#10b981", "#f59e0b", "#0ea5e9"][i % 4] }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-(--text-secondary) sm:text-xs">{s.label}</p>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-(--text-primary) tabular-nums sm:mt-2 sm:text-3xl">
              {s.value.toLocaleString()}
            </p>
            <p className="mt-1 text-[11px] text-(--text-secondary) sm:text-xs">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 shadow-sm sm:p-5">
          <h3 className="mb-4 text-sm font-semibold text-(--text-primary)">{t("panelMachines")}</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-(--text-secondary)">{t("stActivated")}</span>
              <span className="font-semibold text-emerald-600">{count("activated")}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-(--text-secondary)">{t("stPending")}</span>
              <span className="font-semibold text-amber-600">{count("pending")}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-(--text-secondary)">{t("stRevoked")}</span>
              <span className="font-semibold text-red-500">{count("revoked")}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-(--text-secondary)">{t("poolKeys")}</span>
              <span className="font-semibold text-(--text-primary)">{poolKeys}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 shadow-sm sm:p-5">
          <h3 className="mb-4 text-sm font-semibold text-(--text-primary)">{t("panelExpiring")}</h3>
          <ExpiringTrials />
        </div>

        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 shadow-sm sm:p-5">
          <h3 className="mb-4 text-sm font-semibold text-(--text-primary)">{t("panelActivity")}</h3>
          <RecentActivity />
        </div>
      </div>

      {trialsExpiring > 0 && (
        <p className="text-xs text-(--text-secondary)">
          {t("trialsExpiring")}: <span className="font-bold text-amber-600">{trialsExpiring}</span>
        </p>
      )}
    </div>
  );
}

async function ExpiringTrials() {
  const { getTranslations } = await import("next-intl/server");
  const t = await getTranslations("superadmin");
  const rows = await prisma.machine.findMany({
    where: { status: { not: "revoked" }, trialEnd: { gt: new Date(), lt: new Date(Date.now() + 7 * 86400000) } },
    select: { machineId: true, label: true, workshop: true, trialEnd: true },
    orderBy: { trialEnd: "asc" },
    take: 10,
  });
  if (rows.length === 0) return <p className="text-sm text-(--text-secondary)">{t("allHealthy")}</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const daysLeft = Math.ceil((new Date(r.trialEnd!).getTime() - Date.now()) / 86400_000);
        const color = daysLeft <= 2 ? "text-red-500" : daysLeft <= 4 ? "text-amber-600" : "text-(--text-secondary)";
        return (
          <div key={r.machineId} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium text-(--text-primary)">
              {r.workshop || r.label || r.machineId.slice(0, 8)}
            </span>
            <span className={`shrink-0 font-semibold tabular-nums ${color}`} dir="ltr">
              {daysLeft}j
            </span>
          </div>
        );
      })}
    </div>
  );
}

async function RecentActivity() {
  const { getTranslations } = await import("next-intl/server");
  const t = await getTranslations("superadmin");
  const logs = await prisma.superAdminAudit.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { admin: { select: { username: true } } },
  });
  if (logs.length === 0) return <p className="text-sm text-(--text-secondary)">{t("noActivity")}</p>;
  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <div key={log.id} className="flex items-center gap-2 text-xs">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-(--bg-sunken) text-[9px] font-bold text-(--text-secondary)">
            {(log.action || "?")[0].toUpperCase()}
          </span>
          <div className="min-w-0 flex-1 truncate text-(--text-primary)">
            <span className="font-medium">{log.admin?.username || "System"}</span>{" "}
            <span className="text-(--text-secondary)">{log.action.replace(/_/g, " ")}</span>
            {log.targetType && <span className="text-(--text-secondary)"> · {log.targetType}</span>}
          </div>
          <span className="shrink-0 text-(--text-secondary)" dir="ltr">
            {new Date(log.createdAt).toLocaleDateString()}
          </span>
        </div>
      ))}
    </div>
  );
}
