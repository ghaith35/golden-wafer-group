"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BadgeCheck, Banknote, HandCoins, Inbox, Users, Wallet } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Toggle";
import { KpiCard } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/motion/EmptyState";
import { SwipeRow } from "@/components/motion/SwipeRow";
import { toast } from "@/lib/toast";
import { haptic } from "@/lib/motion";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EmployeeRow } from "@/lib/employees/service";
import { EmployeeSheet, type SheetTab } from "./EmployeeSheet";

const selectCls = "h-11 min-w-0 flex-1 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm font-bold outline-none focus:border-(--brand-500) sm:flex-none";

export function EmployeesClient({
  locale, initialRows, initialYear, initialMonth,
}: { locale: string; initialRows: EmployeeRow[]; initialYear: number; initialMonth: number }) {
  const t = useTranslations("employees");
  const tu = useTranslations("users");
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<{ userId: string; tab: SheetTab } | null>(null);
  const [offTarget, setOffTarget] = useState<EmployeeRow | null>(null);

  const load = useCallback(async (y: number, m: number) => {
    const res = await fetch(`/api/employees?year=${y}&month=${m}`, { cache: "no-store" });
    if (res.ok) setRows(await res.json());
  }, []);

  const years = useMemo(() => [initialYear - 2, initialYear - 1, initialYear, initialYear + 1], [initialYear]);
  const monthName = (m: number) => {
    try { return new Date(year, m - 1, 1).toLocaleDateString(locale, { month: "long" }); } catch { return String(m); }
  };

  const needle = q.trim().toLowerCase();
  const visible = rows.filter((r) => !needle || `${r.fullName} ${r.username} ${r.phone ?? ""}`.toLowerCase().includes(needle));
  const onPayroll = visible.filter((r) => r.employee?.isActive);
  const others = visible.filter((r) => !r.employee?.isActive);
  const active = rows.filter((r) => r.employee?.isActive);
  const kpi = {
    count: active.length,
    payroll: active.reduce((s, r) => s + (r.employee?.salary ?? 0), 0),
    advances: active.reduce((s, r) => s + r.outstanding, 0),
    paid: active.reduce((s, r) => s + (r.paid?.net ?? 0), 0),
  };
  const current = open ? rows.find((r) => r.userId === open.userId) ?? null : null;

  async function disable(r: EmployeeRow) {
    if (!r.employee) return;
    const res = await fetch(`/api/employees/${r.employee.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: false }),
    });
    if (res.ok) { toast.success(t("offToast")); await load(year, month); router.refresh(); }
    else toast.error(t("errGeneric"));
  }

  const roleName = (role: string) => (role === "Livreur" ? tu("roleLivreur") : tu("roleVendeur"));

  const renderCard = (r: EmployeeRow, i: number) => {
    const e = r.employee;
    const on = !!e?.isActive;
    return (
      <div key={r.userId} className="gw-rise" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
        <SwipeRow
          width={on ? 168 : 96}
          actions={
            <div className="flex h-full">
              {on && (
                <button type="button" onClick={() => setOpen({ userId: r.userId, tab: "advances" })} className="flex flex-1 flex-col items-center justify-center gap-1 bg-amber-500 text-[11px] font-black text-white">
                  <HandCoins size={18} />{t("advance")}
                </button>
              )}
              <button type="button" onClick={() => setOpen({ userId: r.userId, tab: on ? "payslip" : "profile" })} className="flex flex-1 flex-col items-center justify-center gap-1 bg-emerald-500 text-[11px] font-black text-white">
                <Banknote size={18} />{on ? t("payMonth") : t("toggleOn")}
              </button>
            </div>
          }
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => setOpen({ userId: r.userId, tab: on ? "payslip" : "profile" })}
            onKeyDown={(ev) => { if (ev.key === "Enter") setOpen({ userId: r.userId, tab: on ? "payslip" : "profile" }); }}
            className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border border-(--border-default) bg-(--bg-surface) p-3 transition hover:border-(--brand-500)/60", !on && "opacity-70")}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-base font-black text-(--brand-contrast)">
              {r.fullName.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black">{r.fullName}</div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-(--text-tertiary)">
                <span>{roleName(r.role)}</span>
                {e?.position && <span>· {e.position}</span>}
                {on && <span className="tabular-nums" dir="ltr">· {dzMoney(e!.salary)}</span>}
              </div>
              {on && r.outstanding > 0 && (
                <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-black text-amber-600">
                  <HandCoins size={11} />{t("outstanding")}: <span className="tabular-nums" dir="ltr">{dzMoney(r.outstanding)}</span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {on && (
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black", r.paid ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/10 text-red-500")}>
                  {r.paid && <BadgeCheck size={12} />}{r.paid ? t("paid") : t("unpaid")}
                </span>
              )}
              <span onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}>
                <Switch
                  checked={on}
                  label={t("employeeToggle")}
                  onChange={(v) => {
                    haptic("select");
                    if (v) setOpen({ userId: r.userId, tab: "profile" });
                    else setOffTarget(r);
                  }}
                />
              </span>
            </div>
          </div>
        </SwipeRow>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black">{t("title")}</h1>
        <p className="text-xs font-bold text-(--text-tertiary)">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard compact label={t("kpiHeadcount")} value={String(kpi.count)} icon={<Users size={16} />} accent="bg-sky-500/15 text-sky-500" />
        <KpiCard compact label={t("kpiPayroll")} value={dzMoney(kpi.payroll)} icon={<Wallet size={16} />} accent="bg-violet-500/15 text-violet-500" />
        <KpiCard compact label={t("kpiAdvances")} value={dzMoney(kpi.advances)} icon={<HandCoins size={16} />} accent="bg-amber-500/15 text-amber-500" />
        <KpiCard compact label={`${t("kpiPaid")} · ${monthName(month)}`} value={dzMoney(kpi.paid)} icon={<BadgeCheck size={16} />} accent="bg-emerald-500/15 text-emerald-500" />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <Input placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select aria-label={t("year")} value={year} onChange={(e) => { const y = Number(e.target.value); setYear(y); void load(y, month); }} className={selectCls}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select aria-label={t("month")} value={month} onChange={(e) => { const m = Number(e.target.value); setMonth(m); void load(year, m); }} className={selectCls}>
          {Array.from({ length: 12 }, (_, k) => k + 1).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Inbox size={28} />}
          title={t("emptyTitle")}
          hint={t("emptyHint")}
          action={<Button onClick={() => router.push(`/${locale}/users`)}>{t("goUsers")}</Button>}
        />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-xs font-black uppercase tracking-wide text-(--text-tertiary)">{t("onPayroll")} · {onPayroll.length}</h2>
            {onPayroll.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-(--border-default) p-5 text-center text-xs font-bold text-(--text-tertiary)">{t("noPayroll")}</div>
            ) : (
              onPayroll.map((r, i) => renderCard(r, i))
            )}
          </section>
          {others.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-black uppercase tracking-wide text-(--text-tertiary)">{t("notEmployees")} · {others.length}</h2>
              {others.map((r, i) => renderCard(r, i))}
            </section>
          )}
        </>
      )}

      {current && open && (
        <EmployeeSheet
          key={current.userId}
          row={current}
          year={year}
          month={month}
          monthLabel={`${monthName(month)} ${year}`}
          initialTab={open.tab}
          onClose={() => setOpen(null)}
          onChanged={async () => { await load(year, month); router.refresh(); }}
        />
      )}

      <ConfirmDialog
        open={!!offTarget}
        onClose={() => setOffTarget(null)}
        title={t("toggleOff")}
        confirmLabel={t("toggleOff")}
        message={`${offTarget?.fullName ?? ""} — ${t("toggleOffHint")}`}
        onConfirm={async () => { if (offTarget) await disable(offTarget); setOffTarget(null); }}
      />
    </div>
  );
}
