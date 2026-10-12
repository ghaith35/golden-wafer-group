import { setRequestLocale, getTranslations } from "next-intl/server";
import { DeploymentsClient } from "./DeploymentsClient";
import { TunnelsClient } from "../tunnels/TunnelsClient";

export default async function SuperAdminDeploymentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale: "en", namespace: "superadmin" });
  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-(--brand-500)/30 bg-(--brand-500)/5 p-4">
        <h2 className="text-sm font-black">{t("depHowTitle")}</h2>
        <ol className="mt-2 space-y-1.5">
          {[t("depHow1"), t("depHow2"), t("depHow3"), t("depHow4")].map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] font-semibold">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--brand-500) text-[11px] font-black text-(--brand-contrast)">
                {i + 1}
              </span>
              <span className="min-w-0">{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h1 className="mb-3 text-xl font-black">{t("deployments")}</h1>
        <DeploymentsClient
          labels={{
            depClient: t("depClient"), depCreate: t("depCreate"),
            depEmpty: t("depEmpty"), depRetry: t("depRetry"), depActivate: t("depActivate"),
            depDeactivate: t("depDeactivate"), depUsePrimary: t("depUsePrimary"),
            depUseOverride: t("depUseOverride"),
            depOverride: t("depOverride"), depPrimary: t("depPrimary"),
          }}
        />
      </div>
      <div>
        <h1 className="mb-3 text-xl font-black">{t("tunnels")}</h1>
        <TunnelsClient
          labels={{
            tunnelAllocate: t("tunnelAllocate"), tunnelLabel: t("tunnelLabel"),
            tunnelRevoke: t("tunnelRevoke"), tunnelEmpty: t("tunnelEmpty"),
            tunnelManual: t("tunnelManual"), tunnelToken: t("tunnelToken"),
            tunnelShow: t("tunnelShow"), tunnelHide: t("tunnelHide"),
            tunnelDeleteConfirm: t("tunnelDeleteConfirm"), delete: t("delete"),
          }}
        />
      </div>
    </div>
  );
}
