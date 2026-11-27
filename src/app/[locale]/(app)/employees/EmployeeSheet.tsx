"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, Banknote, HandCoins, UserRound } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AnimatedText } from "@/components/motion/AnimatedText";
import { toast } from "@/lib/toast";
import { celebrate } from "@/lib/celebrate";
import { haptic } from "@/lib/motion";
import { dzMoney, fmtDT } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EmployeeRow } from "@/lib/employees/service";

export type SheetTab = "payslip" | "advances" | "profile";

type Preview = {
  base: number; bonus: number; deduction: number; outstanding: number;
  gross: number; advancesDeducted: number; advancesCarried: number; net: number;
  paid: { id: string; net: number; paidAt: string } | null;
};
type Advance = { id: string; amount: number; remaining: number; date: string; note: string | null };
type Slip = { id: string; year: number; month: number; net: number; paidAt: string };

/// Text boxes keep what you type (no clamping mid-keystroke); parse on use.
const num = (s: string) => {
  const n = Number(s.replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm font-bold tabular-nums outline-none focus:border-(--brand-500)";

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: (data as { error?: string }).error };
}

export function EmployeeSheet({
  row, year, month, monthLabel, initialTab, onClose, onChanged,
}: {
  row: EmployeeRow; year: number; month: number; monthLabel: string; initialTab: SheetTab;
  onClose: () => void; onChanged: () => Promise<void>;
}) {
  const t = useTranslations("employees");
  const e = row.employee;
  const on = !!e?.isActive;
  const [tab, setTab] = useState<SheetTab>(on ? initialTab : "profile");
  const [busy, setBusy] = useState(false);

  const errMsg = (code?: string) => (code === "already_paid" ? t("errAlreadyPaid") : code === "inactive" ? t("errInactive") : t("errGeneric"));

  // ── profile (also the "put on payroll" form) ──
  const [salary, setSalary] = useState(e ? String(e.salary) : "");
  const [position, setPosition] = useState(e?.position ?? "");
  const [nationalId, setNationalId] = useState(e?.nationalId ?? "");
  const [hireDate, setHireDate] = useState((e?.hireDate ?? new Date().toISOString()).slice(0, 10));
  const [notes, setNotes] = useState(e?.notes ?? "");

  async function saveProfile() {
    setBusy(true);
    try {
      const body = { salary: num(salary), position: position || null, nationalId: nationalId || null, notes: notes || null, hireDate };
      const r = e
        ? await send(`/api/employees/${e.id}`, "PATCH", { ...body, ...(on ? {} : { isActive: true }) })
        : await send("/api/employees", "POST", { ...body, userId: row.userId });
      if (!r.ok) { toast.error(errMsg(r.error)); return; }
      toast.success(e && on ? t("saved") : t("onToast"));
      await onChanged();
      if (!on) setTab("payslip");
    } finally { setBusy(false); }
  }

  // ── payslip ──
  const [bonus, setBonus] = useState("");
  const [deduction, setDeduction] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!e || !on) return;
    const ctl = new AbortController();
    const id = window.setTimeout(async () => {
      const qs = new URLSearchParams({ year: String(year), month: String(month), bonus: String(num(bonus)), deduction: String(num(deduction)) });
      const res = await fetch(`/api/employees/${e.id}/payslips?${qs}`, { signal: ctl.signal, cache: "no-store" }).catch(() => null);
      if (res?.ok) setPreview(await res.json());
    }, 200);
    return () => { window.clearTimeout(id); ctl.abort(); };
  }, [e, on, year, month, bonus, deduction, reloadKey]);

  useEffect(() => {
    if (!e || !on) return;
    let live = true;
    void fetch(`/api/employees/${e.id}/payslips?history=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (live) setSlips(d); });
    return () => { live = false; };
  }, [e, on, reloadKey]);

  async function pay() {
    if (!e || !preview) return;
    setBusy(true);
    try {
      const r = await send(`/api/employees/${e.id}/payslips`, "POST", {
        year, month, bonus: num(bonus), deduction: num(deduction), deductionNote: reason || null,
      });
      if (!r.ok) { toast.error(errMsg(r.error)); return; }
      celebrate();
      haptic("success");
      toast.success(t("paidToast"));
      setBonus(""); setDeduction(""); setReason("");
      setReloadKey((k) => k + 1);
      await onChanged();
    } finally { setBusy(false); }
  }

  // ── advances ──
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [advances, setAdvances] = useState<Advance[]>([]);
  useEffect(() => {
    if (!e || !on) return;
    let live = true;
    void fetch(`/api/employees/${e.id}/advances`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (live) setAdvances(d); });
    return () => { live = false; };
  }, [e, on, reloadKey]);

  async function giveAdvance() {
    if (!e || num(amount) <= 0) return;
    setBusy(true);
    try {
      const r = await send(`/api/employees/${e.id}/advances`, "POST", { amount: num(amount), note: note || null });
      if (!r.ok) { toast.error(errMsg(r.error)); return; }
      toast.success(t("advanceToast"));
      setAmount(""); setNote("");
      setReloadKey((k) => k + 1);
      await onChanged();
    } finally { setBusy(false); }
  }

  const tabs: Array<{ key: SheetTab; label: string; icon: React.ReactNode }> = [
    { key: "payslip", label: t("payslip"), icon: <Banknote size={14} /> },
    { key: "advances", label: t("advances"), icon: <HandCoins size={14} /> },
    { key: "profile", label: t("edit"), icon: <UserRound size={14} /> },
  ];

  return (
    <Modal open onClose={onClose} title={row.fullName} subtitle={on ? monthLabel : t("toggleOn")} icon={<Banknote size={18} />} width="lg">
      <div className="space-y-4">
        {on && (
          <div role="tablist" className="grid grid-cols-3 gap-1 rounded-xl bg-(--bg-sunken) p-1">
            {tabs.map((x) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={tab === x.key}
                onClick={() => { haptic("select"); setTab(x.key); }}
                className={cn("flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-black transition", tab === x.key ? "bg-(--bg-surface) text-(--brand-600) shadow" : "text-(--text-secondary)")}
              >
                {x.icon}{x.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Payslip ── */}
        {on && tab === "payslip" && (
          <div className="space-y-3">
            {preview?.paid ? (
              <div className="gw-bump flex items-center gap-3 rounded-2xl bg-emerald-500/10 p-4 text-emerald-600">
                <BadgeCheck size={26} />
                <div>
                  <div className="text-sm font-black">{t("paid")} · <span className="tabular-nums" dir="ltr">{dzMoney(preview.paid.net)}</span></div>
                  <div className="text-[11px] font-bold opacity-80">{t("paidOn")} {fmtDT(preview.paid.paidAt, document.documentElement.lang || "fr")}</div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-[11px] font-black text-(--text-tertiary)">{t("bonus")}
                    <input className={inputCls} dir="ltr" inputMode="decimal" value={bonus} onChange={(ev) => setBonus(ev.target.value)} placeholder="0" />
                  </label>
                  <label className="space-y-1 text-[11px] font-black text-(--text-tertiary)">{t("deduction")}
                    <input className={inputCls} dir="ltr" inputMode="decimal" value={deduction} onChange={(ev) => setDeduction(ev.target.value)} placeholder="0" />
                  </label>
                </div>
                {num(deduction) > 0 && <Input placeholder={t("deductionNote")} value={reason} onChange={(ev) => setReason(ev.target.value)} />}
                <div className="space-y-1.5 rounded-2xl bg-(--bg-sunken) p-3 text-sm font-bold">
                  <Line label={t("base")} value={preview?.base ?? e?.salary ?? 0} />
                  {(preview?.bonus ?? 0) > 0 && <Line label={t("bonus")} value={preview!.bonus} sign="+" />}
                  {(preview?.deduction ?? 0) > 0 && <Line label={t("deduction")} value={preview!.deduction} sign="−" />}
                  {(preview?.advancesDeducted ?? 0) > 0 && <Line label={t("advancesRecovered")} value={preview!.advancesDeducted} sign="−" />}
                  {(preview?.advancesCarried ?? 0) > 0 && (
                    <div className="text-[11px] font-bold text-amber-600">
                      <span className="tabular-nums" dir="ltr">{dzMoney(preview!.advancesCarried)}</span> {t("carried")}
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-(--border-default) pt-2 text-base font-black">
                    <span>{t("net")}</span>
                    <span className="tabular-nums text-(--brand-600)" dir="ltr"><AnimatedText text={dzMoney(preview?.net ?? 0)} /></span>
                  </div>
                </div>
                <p className="text-[11px] font-bold text-(--text-tertiary)">{t("booked")}</p>
                <Button className="w-full" disabled={busy || !preview || (e?.salary ?? 0) <= 0} onClick={pay}>
                  <Banknote size={16} className="me-2" />{t("markPaid")}
                </Button>
                {(e?.salary ?? 0) <= 0 && <p className="text-[11px] font-bold text-red-500">{t("salaryZero")}</p>}
              </>
            )}
            {slips.length > 0 && (
              <div className="space-y-1">
                <div className="text-[11px] font-black uppercase tracking-wide text-(--text-tertiary)">{t("history")}</div>
                {slips.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border border-(--border-default) px-3 py-2 text-xs font-bold">
                    <span className="tabular-nums" dir="ltr">{String(s.month).padStart(2, "0")}/{s.year}</span>
                    <span className="tabular-nums" dir="ltr">{dzMoney(s.net)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Advances ── */}
        {on && tab === "advances" && (
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder={t("advanceAmount")} />
              <Button disabled={busy || num(amount) <= 0} onClick={giveAdvance}>{t("giveAdvance")}</Button>
            </div>
            <Input placeholder={t("advanceNote")} value={note} onChange={(ev) => setNote(ev.target.value)} />
            {row.outstanding > 0 && (
              <div className="rounded-xl bg-amber-500/10 p-3 text-xs font-black text-amber-600">
                {t("outstanding")}: <span className="tabular-nums" dir="ltr">{dzMoney(row.outstanding)}</span>
              </div>
            )}
            <div className="space-y-1">
              <div className="text-[11px] font-black uppercase tracking-wide text-(--text-tertiary)">{t("advanceHistory")}</div>
              {advances.length === 0 && <div className="py-3 text-center text-xs font-bold text-(--text-tertiary)">{t("noAdvances")}</div>}
              {advances.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-(--border-default) px-3 py-2 text-xs font-bold">
                  <div className="min-w-0">
                    <div className="tabular-nums" dir="ltr">{dzMoney(a.amount)}</div>
                    <div className="truncate text-[10px] text-(--text-tertiary)">{fmtDT(a.date, document.documentElement.lang || "fr")}{a.note ? ` · ${a.note}` : ""}</div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black", a.remaining > 0 ? "bg-amber-500/15 text-amber-600" : "bg-emerald-500/15 text-emerald-600")}>
                    {a.remaining > 0 ? <><span className="tabular-nums" dir="ltr">{dzMoney(a.remaining)}</span> {t("remaining")}</> : <BadgeCheck size={12} />}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Profile / put on payroll ── */}
        {tab === "profile" && (
          <div className="space-y-3">
            <label className="block space-y-1 text-[11px] font-black text-(--text-tertiary)">{t("salary")}
              <input className={inputCls} dir="ltr" inputMode="decimal" value={salary} onChange={(ev) => setSalary(ev.target.value)} placeholder="0" autoFocus={!on} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[11px] font-black text-(--text-tertiary)">{t("position")}
                <Input value={position} onChange={(ev) => setPosition(ev.target.value)} />
              </label>
              <label className="space-y-1 text-[11px] font-black text-(--text-tertiary)">{t("nationalId")}
                <Input value={nationalId} onChange={(ev) => setNationalId(ev.target.value)} />
              </label>
            </div>
            <label className="block space-y-1 text-[11px] font-black text-(--text-tertiary)">{t("hireDate")}
              <Input type="date" value={hireDate} onChange={(ev) => setHireDate(ev.target.value)} />
            </label>
            <label className="block space-y-1 text-[11px] font-black text-(--text-tertiary)">{t("notes")}
              <Input value={notes} onChange={(ev) => setNotes(ev.target.value)} />
            </label>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>{t("cancel")}</Button>
              <Button className="flex-1" disabled={busy || num(salary) <= 0} onClick={saveProfile}>{on ? t("save") : t("toggleOn")}</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Line({ label, value, sign }: { label: string; value: number; sign?: "+" | "−" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-(--text-secondary)">{label}</span>
      <span className="tabular-nums" dir="ltr">{sign ? `${sign} ` : ""}{dzMoney(value)}</span>
    </div>
  );
}
