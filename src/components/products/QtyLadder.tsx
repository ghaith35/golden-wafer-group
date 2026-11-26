"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Layers, Plus, Sparkles, Trash2, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { dzMoney } from "@/lib/format";
import { haptic } from "@/lib/motion";
import { pickRung } from "@/lib/pricing";
import { Switch } from "@/components/ui/Toggle";
import { AnimatedText } from "@/components/motion/AnimatedText";

export type LadderRung = { minQty: number; tierId: string | null };
export type LadderUnit = { key: string; label: string; factor: number };
export type LadderValue = Record<string, LadderRung[]>;

/// One colour per rung position (cheap → cheaper): neutral, gold, green, sky…
export const LADDER_TONES = ["#94a3b8", "#e8ba4c", "#10b981", "#38bdf8", "#a78bfa", "#f43f5e"];
const MAX_RUNGS = 6;

/// Log scale keeps 1–9 readable next to 50+ on a phone-wide track.
const scaleMax = (rungs: LadderRung[]) => Math.max(100, (rungs[rungs.length - 1]?.minQty ?? 0) * 2.5);
const toX = (q: number, max: number) => Math.log(q + 1) / Math.log(max + 1);
const fromX = (x: number, max: number) => Math.exp(x * Math.log(max + 1)) - 1;
const snap = (q: number) => (q < 30 ? Math.round(q) : q < 100 ? Math.round(q / 5) * 5 : Math.round(q / 10) * 10);

/// "10 – 49" / "50+" label for rung i (first rung is shown from 1).
function rangeText(r: LadderRung[], i: number, plus: string) {
  const from = i === 0 ? 1 : r[i].minQty;
  const next = r[i + 1];
  return next ? `${from} – ${Math.max(from, next.minQty - 1)}` : `${from} ${plus}`;
}

/// Per-colisage quantity price ladder builder: a draggable range track, tier
/// chips per range, live price preview and a "try a quantity" simulator.
export function QtyLadder({
  units,
  tiers,
  baseLabel,
  priceOfTier,
  hasTierPrice,
  value,
  onChange,
}: {
  units: LadderUnit[];
  tiers: Array<{ id: string; name: string }>;
  /// Label of the base sale price (سعر البيع).
  baseLabel: string;
  /// Price per BASE unit for a tier (null = base sale price), with the same
  /// fallback the sale screens use.
  priceOfTier: (tierId: string | null) => number;
  hasTierPrice: (tierId: string) => boolean;
  value: LadderValue;
  onChange: (next: LadderValue) => void;
}) {
  const t = useTranslations("products");
  const tierName = (id: string | null) => (id ? (tiers.find((x) => x.id === id)?.name ?? "—") : baseLabel);
  const options = [{ id: null as string | null, name: baseLabel }, ...tiers.map((x) => ({ id: x.id as string | null, name: x.name }))];

  const defaults = (): LadderRung[] => {
    const rungs: LadderRung[] = [{ minQty: 0, tierId: null }];
    if (tiers[0]) rungs.push({ minQty: 10, tierId: tiers[0].id });
    if (tiers[1]) rungs.push({ minQty: 50, tierId: tiers[1].id });
    return rungs;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl bg-(--brand-500)/10 p-3 text-xs leading-5 text-(--text-secondary)">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-(--brand-600)" />
        <span>{t("ladderHint")}</span>
      </div>
      {tiers.length === 0 && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-xs font-bold text-amber-600">
          <AlertTriangle size={15} className="shrink-0" />
          {t("ladderNoTiers")}
        </p>
      )}
      {units.map((u) => (
        <UnitLadder
          key={u.key}
          unit={u}
          rungs={value[u.key] ?? []}
          options={options}
          tierName={tierName}
          priceOfTier={priceOfTier}
          hasTierPrice={hasTierPrice}
          canEnable={tiers.length > 0}
          onChange={(r) => onChange({ ...value, [u.key]: r })}
          onEnable={() => onChange({ ...value, [u.key]: defaults() })}
          onDisable={() => onChange({ ...value, [u.key]: [] })}
        />
      ))}
    </div>
  );
}

/// Number box that lets you type freely (select-all + retype replaces the whole
/// value). The neighbour clamp is applied live only when the typed number is in
/// range, and always on blur/Enter — never mid-keystroke.
function MinInput({ value, lo, hi, disabled, onCommit }: { value: number; lo: number; hi: number; disabled?: boolean; onCommit: (q: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft !== null) {
      const n = Math.round(Number(draft));
      if (draft.trim() !== "" && Number.isFinite(n)) onCommit(Math.max(lo, Math.min(hi, n)));
      setDraft(null);
    }
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      dir="ltr"
      disabled={disabled}
      value={draft ?? String(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 7);
        setDraft(v);
        const n = Number(v);
        if (v !== "" && n >= lo && n <= hi) onCommit(n);
      }}
      onBlur={finish}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); finish(); e.currentTarget.blur(); } }}
      className="h-10 w-20 rounded-lg border border-(--border-default) bg-(--bg-sunken) px-2 text-center text-sm font-black tabular-nums outline-none focus:border-(--brand-500) disabled:opacity-60"
    />
  );
}

function UnitLadder({
  unit, rungs, options, tierName, priceOfTier, hasTierPrice, canEnable, onChange, onEnable, onDisable,
}: {
  unit: LadderUnit;
  rungs: LadderRung[];
  options: Array<{ id: string | null; name: string }>;
  tierName: (id: string | null) => string;
  priceOfTier: (tierId: string | null) => number;
  hasTierPrice: (tierId: string) => boolean;
  canEnable: boolean;
  onChange: (r: LadderRung[]) => void;
  onEnable: () => void;
  onDisable: () => void;
}) {
  const t = useTranslations("products");
  const rtl = useLocale() === "ar";
  const on = rungs.length >= 2;
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [tryQ, setTryQ] = useState(1);
  const max = scaleMax(rungs);
  const unitPrice = (tierId: string | null) => priceOfTier(tierId) * unit.factor;
  const p0 = unitPrice(rungs[0]?.tierId ?? null);

  const setRung = (i: number, patch: Partial<LadderRung>) => onChange(rungs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setMin = (i: number, q: number) => {
    const lo = (rungs[i - 1]?.minQty ?? 0) + 1;
    const hi = rungs[i + 1] ? rungs[i + 1].minQty - 1 : 10_000_000;
    const v = Math.max(lo, Math.min(hi, Math.round(q)));
    if (v !== rungs[i].minQty) setRung(i, { minQty: v });
  };
  const addRung = () => {
    if (rungs.length >= MAX_RUNGS) return;
    const last = rungs[rungs.length - 1];
    const used = new Set(rungs.map((r) => r.tierId));
    const tier = options.find((o) => !used.has(o.id)) ?? options[options.length - 1];
    haptic("select");
    onChange([...rungs, { minQty: Math.max(last.minQty * 2, last.minQty + 10), tierId: tier.id }]);
  };
  const removeRung = (i: number) => {
    haptic("tap");
    const next = rungs.filter((_, j) => j !== i);
    if (next.length > 0) next[0] = { ...next[0], minQty: 0 };
    onChange(next.length >= 2 ? next : []);
  };

  const onHandleMove = (i: number, clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const raw = rtl ? (rect.right - clientX) / rect.width : (clientX - rect.left) / rect.width;
    const x = Math.min(1, Math.max(0, raw));
    setMin(i, snap(fromX(x, max)));
  };

  const pick = on ? pickRung(rungs.map((r) => ({ ...r, unitKey: "u" })), "u", tryQ) : null;
  const tryPrice = pick ? unitPrice(pick.rung.tierId) : unitPrice(null);

  return (
    <div className={cn("overflow-hidden rounded-2xl border transition-colors", on ? "border-(--brand-500)/50 bg-(--bg-overlay)" : "border-(--border-default) bg-(--bg-sunken)/40")}>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", on ? "bg-gradient-brand text-(--brand-contrast)" : "bg-(--bg-sunken) text-(--text-secondary)")}>
          <Layers size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black">{unit.label}</div>
          <div className="text-[11px] font-bold text-(--text-tertiary)">
            {t("ladderUnitsHint")} {unit.label}{unit.factor !== 1 ? ` · ×${Math.round(unit.factor * 1000) / 1000}` : ""}
          </div>
        </div>
        {on && (
          <button type="button" onClick={() => { haptic("select"); onEnable(); }} className="hidden h-8 items-center gap-1 rounded-lg bg-(--bg-sunken) px-2.5 text-[11px] font-black text-(--text-secondary) hover:text-(--brand-600) sm:flex">
            <Sparkles size={13} />{t("ladderAuto")}
          </button>
        )}
        <Switch checked={on} disabled={!canEnable} label={t("ladderTitle")} onChange={(v) => (v ? onEnable() : onDisable())} />
      </div>

      {on && (
        <div className="space-y-3 border-t border-(--border-default) px-3.5 pb-4 pt-3">
          {/* ── Range track: drag the dividers ── */}
          <div ref={trackRef} dir={rtl ? "rtl" : "ltr"} className="relative flex h-[88px] touch-none select-none overflow-hidden rounded-2xl border border-(--border-default)">
            {rungs.map((r, i) => {
              const w = (toX(rungs[i + 1]?.minQty ?? max, max) - toX(r.minQty, max)) * 100;
              const color = LADDER_TONES[i % LADDER_TONES.length];
              const price = unitPrice(r.tierId);
              const pct = i > 0 && p0 > 0 ? Math.round((1 - price / p0) * 100) : 0;
              const active = pick?.index === i;
              return (
                <div
                  key={i}
                  className="relative flex min-w-0 flex-col justify-center overflow-hidden px-2.5"
                  style={{
                    width: `${w}%`,
                    background: `linear-gradient(160deg, ${color}40, ${color}14)`,
                    boxShadow: active ? `inset 0 0 0 2px ${color}` : undefined,
                    transition: drag === null ? "width 0.45s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s" : "box-shadow 0.2s",
                  }}
                >
                  <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
                  <div className="truncate text-[11px] font-black opacity-70"><bdi>{rangeText(rungs, i, t("ladderPlus"))}</bdi></div>
                  <div className="truncate text-sm font-black tabular-nums sm:text-base"><bdi>{dzMoney(price)}</bdi></div>
                  <div className="flex items-center gap-1 truncate text-[10px] font-black" style={{ color }}>
                    <span className="truncate">{tierName(r.tierId)}</span>
                    {pct > 0 && <span className="shrink-0 rounded-full px-1.5 py-px text-white" style={{ background: color }}>−{pct}%</span>}
                  </div>
                </div>
              );
            })}
            {rungs.slice(1).map((r, k) => {
              const i = k + 1;
              const left = toX(r.minQty, max) * 100;
              return (
                <button
                  key={i}
                  type="button"
                  role="slider"
                  aria-label={`${tierName(r.tierId)} ${t("ladderFrom")}`}
                  aria-valuemin={(rungs[i - 1]?.minQty ?? 0) + 1}
                  aria-valuemax={rungs[i + 1] ? rungs[i + 1].minQty - 1 : 10_000_000}
                  aria-valuenow={r.minQty}
                  data-no-ripple
                  className={cn("absolute top-0 z-[2] flex h-full w-8 cursor-ew-resize items-center justify-center outline-none", rtl ? "translate-x-1/2" : "-translate-x-1/2")}
                  style={{ [rtl ? "right" : "left"]: `${left}%`, transition: drag === i ? "none" : `${rtl ? "right" : "left"} 0.45s cubic-bezier(0.34,1.56,0.64,1)` }}
                  onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(i); haptic("select"); }}
                  onPointerMove={(e) => { if (drag === i) onHandleMove(i, e.clientX); }}
                  onPointerUp={() => setDrag(null)}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(e) => {
                    const up = rtl ? "ArrowLeft" : "ArrowRight";
                    const down = rtl ? "ArrowRight" : "ArrowLeft";
                    if (e.key === up || e.key === "ArrowUp") { e.preventDefault(); setMin(i, r.minQty + 1); }
                    if (e.key === down || e.key === "ArrowDown") { e.preventDefault(); setMin(i, r.minQty - 1); }
                  }}
                >
                  <span className={cn("flex h-10 w-3.5 flex-col items-center justify-center gap-[3px] rounded-full bg-white shadow-lg ring-1 ring-black/10 transition-transform", drag === i && "scale-110")}>
                    <i className="h-1 w-1 rounded-full bg-slate-400" /><i className="h-1 w-1 rounded-full bg-slate-400" /><i className="h-1 w-1 rounded-full bg-slate-400" />
                  </span>
                  <span className={cn("pointer-events-none absolute -top-0.5 rounded-b-lg px-1.5 py-0.5 text-[10px] font-black text-white transition-opacity", drag === i ? "opacity-100" : "opacity-0")} style={{ background: LADDER_TONES[i % LADDER_TONES.length] }}>
                    {r.minQty}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Editable rows ── */}
          <div className="space-y-2">
            {rungs.map((r, i) => {
              const color = LADDER_TONES[i % LADDER_TONES.length];
              const price = unitPrice(r.tierId);
              const missing = r.tierId !== null && !hasTierPrice(r.tierId);
              const notCheaper = i > 0 && price >= unitPrice(rungs[i - 1].tierId) - 1e-9;
              return (
                <div key={i} className="rounded-xl border border-(--border-default) bg-(--bg-surface) p-2.5" style={{ borderInlineStartWidth: 4, borderInlineStartColor: color }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-black text-(--text-tertiary)">{t("ladderFrom")}</span>
                      <MinInput
                        disabled={i === 0}
                        value={i === 0 ? 1 : r.minQty}
                        lo={(rungs[i - 1]?.minQty ?? 0) + 1}
                        hi={rungs[i + 1] ? rungs[i + 1].minQty - 1 : 10_000_000}
                        onCommit={(q) => setMin(i, q)}
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="radiogroup">
                      {options.map((o) => {
                        const sel = o.id === r.tierId;
                        return (
                          <button
                            key={o.id ?? "base"}
                            type="button"
                            role="radio"
                            aria-checked={sel}
                            onClick={() => { if (!sel) haptic("select"); setRung(i, { tierId: o.id }); }}
                            className={cn("h-9 rounded-full border px-3 text-xs font-black transition-all", sel ? "text-white shadow-md" : "border-(--border-default) bg-(--bg-overlay) text-(--text-secondary) hover:border-(--border-strong)")}
                            style={sel ? { background: color, borderColor: color } : undefined}
                          >
                            {o.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="ms-auto flex items-center gap-2">
                      <span className="text-sm font-black tabular-nums" dir="ltr">{dzMoney(price)}</span>
                      {i > 0 && (
                        <button type="button" onClick={() => removeRung(i)} aria-label={t("ladderRemove")} title={t("ladderRemove")} className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                  {(missing || notCheaper) && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-amber-600">
                      <AlertTriangle size={12} className="shrink-0" />
                      {missing ? t("ladderNoPrice") : t("ladderNotCheaper")}
                    </p>
                  )}
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              {rungs.length < MAX_RUNGS && (
                <button type="button" onClick={addRung} className="flex h-10 items-center gap-1.5 rounded-xl border border-dashed border-(--border-strong) px-3 text-xs font-black text-(--text-secondary) hover:border-(--brand-500) hover:text-(--brand-600)">
                  <Plus size={15} />{t("ladderAdd")}
                </button>
              )}
              <button type="button" onClick={() => { haptic("tap"); onDisable(); }} className="h-10 rounded-xl px-3 text-xs font-black text-(--text-tertiary) hover:text-red-500 sm:hidden">
                {t("ladderRemove")}
              </button>
            </div>
          </div>

          {/* ── Try it ── */}
          <div className="rounded-xl bg-(--bg-sunken) p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-black text-(--text-tertiary)">
              <TrendingDown size={13} />{t("ladderTry")}
            </div>
            <div className="flex items-center gap-3" dir={rtl ? "rtl" : "ltr"}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={toX(tryQ, max)}
                onChange={(e) => setTryQ(Math.max(1, snap(fromX(Number(e.target.value), max))))}
                aria-label={t("ladderTry")}
                className="h-2 min-w-0 flex-1 cursor-pointer accent-(--brand-500)"
              />
              <MinInput value={tryQ} lo={1} hi={10_000_000} onCommit={setTryQ} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full px-2.5 py-1 text-xs font-black text-white transition-colors" style={{ background: LADDER_TONES[(pick?.index ?? 0) % LADDER_TONES.length] }}>
                {tierName(pick?.rung.tierId ?? rungs[0].tierId)}
              </span>
              <span className="text-xs font-bold text-(--text-secondary)">
                <bdi>{tryQ}</bdi> × <b className="tabular-nums"><AnimatedText text={dzMoney(tryPrice)} ms={350} /></b>
                {" "}= <b className="text-sm text-(--brand-600) tabular-nums"><AnimatedText text={dzMoney(tryPrice * tryQ)} ms={450} /></b>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
