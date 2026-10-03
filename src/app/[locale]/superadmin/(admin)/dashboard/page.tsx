import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { KpiCard } from "@/components/ui/Card";
import { Building2, KeyRound, MonitorSmartphone, Hourglass } from "lucide-react";

export default async function SuperAdminDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("superadmin");
  const [byStatus, trialsExpiring, companies, poolKeys] = await Promise.all([
    prisma.machine.groupBy({ by: ["status"], _count: true }),
    prisma.machine.count({
      where: { status: { not: "revoked" }, trialEnd: { gt: new Date(), lt: new Date(Date.now() + 7 * 86400000) } },
    }),
    prisma.company.count(),
    prisma.licenseKey.count({ where: { revoked: false, machineId: null, consumedByMachineId: null } }),
  ]);
  const count = (s: string) => byStatus.find((x) => x.status === s)?._count ?? 0;
  const cards = [
    { label: t("stActivated"), value: String(count("activated")), icon: <MonitorSmartphone size={20} />, accent: "bg-emerald-500/15 text-emerald-600" },
    { label: t("stPending"), value: String(count("pending")), icon: <Hourglass size={20} />, accent: "bg-amber-500/15 text-amber-600" },
    { label: t("stRevoked"), value: String(count("revoked")), icon: <KeyRound size={20} />, accent: "bg-red-500/15 text-red-500" },
    { label: t("trialsExpiring"), value: String(trialsExpiring), icon: <Hourglass size={20} />, accent: "bg-sky-500/15 text-sky-600" },
    { label: t("companies"), value: String(companies), icon: <Building2 size={20} />, accent: "bg-violet-500/15 text-violet-600" },
    { label: t("poolKeys"), value: String(poolKeys), icon: <KeyRound size={20} />, accent: "bg-(--brand-500)/15 text-(--brand-600)" },
  ];
  return (
    <div>
      <h1 className="mb-3 text-xl font-black">{t("dashboard")}</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {cards.map((c) => (
          <KpiCard key={c.label} label={c.label} value={c.value} icon={c.icon} accent={c.accent} />
        ))}
      </div>
    </div>
  );
}
