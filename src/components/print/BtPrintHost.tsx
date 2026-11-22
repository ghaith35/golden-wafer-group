"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Bluetooth, Check, ChevronDown, Loader2, Printer, RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { bytesToBase64 } from "@/lib/escpos";
import { ticketToEscPos } from "@/lib/ticket-raster";
import { printTicketSystem } from "@/lib/print-ticket";
import {
  btErr,
  btPlugin,
  closeBtPrint,
  forgetPrinter,
  getBtPrintRequest,
  loadCut,
  loadPrinter,
  registerBtHost,
  saveCut,
  savePrinter,
  subscribeBtPrint,
  type BtDevice,
  type BtErrCode,
  type BtPrintRequest,
  type BtState,
  type BtTransport,
  type SavedPrinter,
} from "@/lib/bt-printer";

/// Full-screen "Printer" page for the APK. Opens from any Print button
/// (printTicketNative → requestBtPrint): checks permission / Bluetooth,
/// searches for Bluetooth printers, lets the driver pick one, prints the
/// ticket over Bluetooth, remembers the printer. Every failure has a clear
/// message and a way forward (retry · another printer · system print).

type View =
  | { k: "checking" }
  | { k: "perm"; denied: boolean }
  | { k: "btOff" }
  | { k: "locOff" }
  | { k: "list" }
  | { k: "working"; step: "render" | "pair" | "send"; dev: BtDevice }
  | { k: "done"; dev: BtDevice }
  | { k: "error"; code: BtErrCode; dev?: BtDevice };

const PRINTER_NAME = /print|xp[-_ ]?\d|xprinter|pos|rpp|mtp|thermal|gp-|zj-|spp|receipt|tsc|munbyn|milestone|bluetooth ?printer|\bbt[-_]?\d/i;

function isPrinterLike(d: BtDevice) {
  return d.major === 0x600 || PRINTER_NAME.test(d.name);
}

function transportOf(d: BtDevice, saved?: SavedPrinter | null): BtTransport | undefined {
  if (d.le && !d.classic) return "ble";
  if (d.classic && !d.le) return "classic";
  if (d.type === 2) return "ble";
  if (saved && saved.address === d.address) return saved.transport;
  return undefined;
}

export function BtPrintHost() {
  useEffect(() => registerBtHost(), []);
  const req = useSyncExternalStore(subscribeBtPrint, getBtPrintRequest, () => null);
  if (!req) return null;
  return <BtPrintScreen key={req.id} req={req} />;
}

function BtPrintScreen({ req }: { req: BtPrintRequest }) {
  const t = useTranslations("btPrint");
  const locale = useLocale();
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;
  const plugin = btPlugin();

  const [view, setView] = useState<View>({ k: "checking" });
  const [devices, setDevices] = useState<Record<string, BtDevice>>({});
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [showOther, setShowOther] = useState(false);
  // Client-only component (mounted after a tap) → reading localStorage in the initializer is safe.
  const [cut, setCut] = useState(() => loadCut());
  const [saved, setSaved] = useState<SavedPrinter | null>(() => loadPrinter());

  const alive = useRef(true);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bytesRef = useRef<{ cut: boolean; data: Uint8Array } | null>(null);
  const viewRef = useRef<View>(view);
  const cutRef = useRef(cut);
  useEffect(() => {
    viewRef.current = view;
    cutRef.current = cut;
  }, [view, cut]);
  const poppedRef = useRef(false);
  const busyRef = useRef(false);

  // ── lifecycle: close handling (button, Android back, unmount) ─────────────
  const close = useCallback(() => {
    closeBtPrint();
  }, []);

  useEffect(() => {
    alive.current = true;
    // Android back button closes the screen instead of leaving the page.
    try {
      window.history.pushState({ gwBt: 1 }, "");
    } catch {
      /* ignore */
    }
    const onPop = () => {
      poppedRef.current = true;
      closeBtPrint();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      alive.current = false;
      window.removeEventListener("popstate", onPop);
      if (poll.current) clearInterval(poll.current);
      if (doneTimer.current) clearTimeout(doneTimer.current);
      if (viewRef.current.k === "working") plugin.cancel().catch(() => {});
      plugin.stopDiscovery().catch(() => {});
      try {
        if (!poppedRef.current && window.history.state?.gwBt) window.history.back();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── scanning ─────────────────────────────────────────────────────────────
  const mergeDevices = useCallback((list: BtDevice[]) => {
    setDevices((prev) => {
      const next = { ...prev };
      for (const d of list) {
        const old = next[d.address];
        next[d.address] = old
          ? { ...old, ...d, name: d.name || old.name, le: d.le || old.le, classic: d.classic || old.classic, bonded: d.bonded || old.bonded }
          : d;
      }
      return next;
    });
  }, []);

  const startScan = useCallback(async () => {
    if (poll.current) clearInterval(poll.current);
    setScanning(true);
    setScanned(false);
    try {
      await plugin.startDiscovery();
    } catch (e) {
      if (!alive.current) return;
      setScanning(false);
      const code = btErr(e);
      if (code === "no_permission") setView({ k: "perm", denied: false });
      else if (code === "bt_off") setView({ k: "btOff" });
      else setView({ k: "error", code });
      return;
    }
    const tick = async () => {
      try {
        const r = await plugin.getDiscovered();
        if (!alive.current) return;
        mergeDevices(r.devices ?? []);
        if (!r.scanning) {
          if (poll.current) clearInterval(poll.current);
          poll.current = null;
          setScanning(false);
          setScanned(true);
        }
      } catch {
        /* transient — next tick */
      }
    };
    poll.current = setInterval(tick, 700);
    void tick();
  }, [mergeDevices, plugin]);

  const enterList = useCallback(async () => {
    setView({ k: "list" });
    try {
      const b = await plugin.bonded();
      if (alive.current) mergeDevices(b.devices ?? []);
    } catch {
      /* the scan below will surface a permission problem */
    }
    if (alive.current) void startScan();
  }, [mergeDevices, plugin, startScan]);

  /// One place that routes every failure to the right screen.
  const fail = useCallback(
    (e: unknown, dev?: BtDevice) => {
      if (!alive.current) return;
      const code = typeof e === "string" ? (e as BtErrCode) : btErr(e);
      if (code === "cancelled") return void enterList();
      if (code === "no_permission") return setView({ k: "perm", denied: false });
      if (code === "bt_off") return setView({ k: "btOff" });
      setView({ k: "error", code, dev });
    },
    [enterList],
  );

  // ── printing ─────────────────────────────────────────────────────────────
  const ensureBytes = useCallback(async (): Promise<Uint8Array> => {
    const wantCut = cutRef.current;
    if (bytesRef.current && bytesRef.current.cut === wantCut) return bytesRef.current.data;
    const a = req.args;
    const data = await ticketToEscPos(
      {
        ticket: a.ticket,
        company: { name: a.company.name, phone: a.company.phone, address: a.company.address, rc: a.company.rc, nif: a.company.nif },
        labels: a.labels,
        lang: a.lang,
        qrDataUrl: a.qrDataUrl ?? null,
      },
      { cut: wantCut },
    );
    bytesRef.current = { cut: wantCut, data };
    return data;
  }, [req.args]);

  const run = useCallback(
    async (dev0: BtDevice) => {
      if (busyRef.current) return; // double tap / overlapping boot → never two jobs
      busyRef.current = true;
      let dev = dev0;
      try {
        if (poll.current) clearInterval(poll.current);
        poll.current = null;
        setScanning(false);
        plugin.stopDiscovery().catch(() => {});

        setView({ k: "working", step: "render", dev });
        let data: Uint8Array;
        try {
          data = await ensureBytes();
        } catch {
          return fail("render_failed", dev);
        }
        if (!alive.current) return;

        // A remembered printer carries no live pairing info — refresh it.
        if (!dev.bonded) {
          try {
            const b = await plugin.bonded();
            const hit = (b.devices ?? []).find((d) => d.address === dev.address);
            if (hit) dev = { ...dev, bonded: true, type: hit.type || dev.type };
          } catch (e) {
            if (btErr(e) === "no_permission") return fail(e, dev);
          }
        }
        let transport = transportOf(dev, loadPrinter());
        if (!dev.bonded && transport !== "ble") {
          setView({ k: "working", step: "pair", dev });
          try {
            await plugin.pair({ address: dev.address });
            dev = { ...dev, bonded: true };
          } catch (e) {
            return fail(e, dev);
          }
        }
        if (!alive.current) return;

        setView({ k: "working", step: "send", dev });
        const res = await plugin.write({ address: dev.address, data: bytesToBase64(data), transport });
        if (!alive.current) return;
        const used = res?.transport === "ble" || res?.transport === "classic" ? res.transport : transport;
        transport = used;
        savePrinter({ address: dev.address, name: dev.name || loadPrinter()?.name || dev.address, transport });
        setSaved(loadPrinter());
        setView({ k: "done", dev });
        doneTimer.current = setTimeout(() => {
          if (alive.current) close();
        }, 1600);
      } catch (e) {
        fail(e, dev);
      } finally {
        busyRef.current = false;
      }
    },
    [close, ensureBytes, fail, plugin],
  );

  // ── boot: permission → bluetooth → location → remembered printer / list ──
  const boot = useCallback(
    async (opts?: { skipRemembered?: boolean }) => {
      setView({ k: "checking" });
      let s: BtState;
      try {
        s = await plugin.getState();
      } catch (e) {
        if (alive.current) setView({ k: "error", code: btErr(e) === "unknown" ? "no_plugin" : btErr(e) });
        return;
      }
      if (!alive.current) return;
      if (!s.supported) return setView({ k: "error", code: "bt_unsupported" });
      if (!s.permission) return setView({ k: "perm", denied: s.permanentlyDenied });
      if (!s.enabled) return setView({ k: "btOff" });
      if (s.locationNeeded && !s.locationOn) return setView({ k: "locOff" });
      const mine = loadPrinter();
      if (mine && !opts?.skipRemembered) {
        void run({ address: mine.address, name: mine.name, type: 0, major: 0, bonded: false, ...(mine.transport === "ble" ? { le: true } : {}) });
        return;
      }
      void enterList();
    },
    [enterList, plugin, run],
  );

  useEffect(() => {
    const id = setTimeout(() => void boot(), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from the system settings / permission pages → re-check.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const k = viewRef.current.k;
      if (k === "perm" || k === "btOff" || k === "locOff") void boot({ skipRemembered: false });
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [boot]);

  // ── actions ──────────────────────────────────────────────────────────────
  const askPermission = async () => {
    try {
      const s = await plugin.requestBt();
      if (!alive.current) return;
      if (s.permission) return void boot();
      setView({ k: "perm", denied: s.permanentlyDenied });
    } catch {
      if (alive.current) setView({ k: "perm", denied: true });
    }
  };
  const turnOn = async () => {
    try {
      await plugin.enableBt();
    } catch {
      /* user declined / no permission — boot re-checks and shows the right screen */
    }
    if (alive.current) void boot();
  };
  const systemPrint = async () => {
    close();
    await printTicketSystem(req.args);
  };
  const retry = (dev?: BtDevice) => {
    if (dev) void run(dev);
    else void boot();
  };
  const chooseOther = () => {
    forgetPrinter();
    setSaved(null);
    void boot({ skipRemembered: true });
  };
  const cancelWork = () => {
    plugin.cancel().catch(() => {});
  };

  // ── derived lists ────────────────────────────────────────────────────────
  const { paired, nearby, other } = useMemo(() => {
    const all = Object.values(devices);
    const mine = saved?.address;
    const byRssi = (a: BtDevice, b: BtDevice) => (b.rssi ?? -200) - (a.rssi ?? -200);
    const paired = all.filter((d) => d.bonded).sort((a, b) => (a.address === mine ? -1 : b.address === mine ? 1 : isPrinterLike(b) ? 1 : -1));
    const rest = all.filter((d) => !d.bonded);
    const nearby = rest.filter((d) => d.name && isPrinterLike(d)).sort(byRssi);
    const other = rest.filter((d) => !(d.name && isPrinterLike(d))).sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || byRssi(a, b));
    return { paired, nearby, other };
  }, [devices, saved]);

  const dev = "dev" in view ? view.dev : undefined;
  const devName = dev?.name || saved?.name || "";

  // ── UI ───────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-(--bg-surface) text-(--text-primary)" role="dialog" aria-modal aria-label={t("title")}>
      <header className="flex shrink-0 items-center gap-3 border-b border-(--border-default) px-3 py-3">
        <button
          type="button"
          onClick={close}
          aria-label={t("close")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <Back size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-black">{t("title")}</h1>
          <p className="truncate text-xs opacity-60">{t("subtitle")}</p>
        </div>
        <Bluetooth size={20} className="shrink-0 text-(--brand-600)" aria-hidden />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {view.k === "checking" && <Centered icon={<Loader2 size={34} className="animate-spin" />} title={t("checking")} />}

        {view.k === "perm" && (
          <Centered
            icon={<Bluetooth size={36} />}
            title={t("permTitle")}
            body={view.denied ? t("permDeniedBody") : t("permBody")}
            actions={
              view.denied ? (
                <>
                  <Primary onClick={() => plugin.openAppSettings().catch(() => {})}>{t("openSettings")}</Primary>
                  <Secondary onClick={() => void boot()}>{t("retry")}</Secondary>
                </>
              ) : (
                <Primary onClick={askPermission}>{t("permAllow")}</Primary>
              )
            }
          />
        )}

        {view.k === "btOff" && (
          <Centered icon={<Bluetooth size={36} className="opacity-50" />} title={t("btOffTitle")} body={t("btOffBody")} actions={<Primary onClick={turnOn}>{t("btOn")}</Primary>} />
        )}

        {view.k === "locOff" && (
          <Centered
            icon={<TriangleAlert size={36} />}
            title={t("locTitle")}
            body={t("locBody")}
            actions={
              <>
                <Primary onClick={() => plugin.openLocationSettings().catch(() => {})}>{t("openLocation")}</Primary>
                <Secondary onClick={() => void boot()}>{t("retry")}</Secondary>
              </>
            }
          />
        )}

        {view.k === "list" && (
          <div className="space-y-4">
            <p className="text-sm opacity-70">{t("listHint")}</p>

            <div className="flex items-center gap-2">
              {scanning ? (
                <span className="flex items-center gap-2 text-sm font-bold">
                  <Loader2 size={16} className="animate-spin" /> {t("searching")}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void startScan()}
                  className="flex h-11 items-center gap-2 rounded-xl border border-(--border-default) px-4 text-sm font-black"
                >
                  <RefreshCw size={15} /> {t("searchAgain")}
                </button>
              )}
            </div>

            {paired.length > 0 && <Section title={t("paired")}>{paired.map((d) => <DeviceRow key={d.address} d={d} mine={d.address === saved?.address} onPick={() => void run(d)} t={t} />)}</Section>}
            {nearby.length > 0 && <Section title={t("nearby")}>{nearby.map((d) => <DeviceRow key={d.address} d={d} onPick={() => void run(d)} t={t} />)}</Section>}

            {scanned && paired.length === 0 && nearby.length === 0 && (
              <div className="rounded-2xl border border-dashed border-(--border-default) p-5 text-center">
                <p className="text-sm font-black">{t("noneFound")}</p>
                <p className="mt-1.5 text-xs leading-5 opacity-70">{t("noneFoundHint")}</p>
              </div>
            )}

            {other.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowOther((v) => !v)}
                  className="flex h-11 w-full items-center justify-between rounded-xl border border-(--border-default) px-4 text-sm font-bold"
                >
                  <span>{showOther ? t("hideOther") : t("showOther", { n: other.length })}</span>
                  <ChevronDown size={16} className={cn("transition-transform", showOther && "rotate-180")} />
                </button>
                {showOther && <div className="mt-2 space-y-2">{other.map((d) => <DeviceRow key={d.address} d={d} onPick={() => void run(d)} t={t} />)}</div>}
              </div>
            )}

            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-(--border-default) px-4 py-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={cut}
                onChange={(e) => {
                  setCut(e.target.checked);
                  saveCut(e.target.checked);
                }}
                className="h-5 w-5"
              />
              {t("cutPaper")}
            </label>
          </div>
        )}

        {view.k === "working" && (
          <Centered
            icon={<Loader2 size={38} className="animate-spin" />}
            title={view.step === "render" ? t("rendering") : view.step === "pair" ? t("pairing") : t("sending")}
            body={view.step === "pair" ? t("pairingHint") : view.step === "send" ? t("sendingHint") : undefined}
            sub={devName ? t("printingTo", { name: devName }) : undefined}
            actions={
              view.step === "send" ? <Secondary onClick={cancelWork}>{t("cancel")}</Secondary> : undefined
            }
          />
        )}

        {view.k === "done" && (
          <Centered
            icon={<span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600"><Check size={36} /></span>}
            title={t("done")}
            sub={devName ? t("printingTo", { name: devName }) : undefined}
            actions={
              <>
                <Primary onClick={close}>{t("close")}</Primary>
                <Secondary onClick={() => void run(view.dev)}>{t("printAgain")}</Secondary>
              </>
            }
          />
        )}

        {view.k === "error" && (
          <Centered
            icon={<span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-500"><TriangleAlert size={34} /></span>}
            title={t(`e_${view.code}`)}
            body={t(`e_${view.code}_tip`)}
            sub={devName ? t("printingTo", { name: devName }) : undefined}
            actions={
              <>
                {view.code !== "bt_unsupported" && view.code !== "no_plugin" && (
                  <Primary onClick={() => retry(view.dev)}>{t("retry")}</Primary>
                )}
                {view.code !== "bt_unsupported" && view.code !== "no_plugin" && <Secondary onClick={chooseOther}>{t("chooseOther")}</Secondary>}
                <Secondary onClick={() => void systemPrint()}>{t("systemPrint")}</Secondary>
              </>
            }
          />
        )}
      </main>

      {(view.k === "list" || view.k === "error") && (
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-(--border-default) px-4 py-3">
          <button type="button" onClick={() => void systemPrint()} className="flex h-11 items-center gap-2 rounded-xl px-3 text-xs font-bold opacity-70">
            <Printer size={15} /> {t("systemPrint")}
          </button>
          {saved && view.k === "list" && (
            <button
              type="button"
              onClick={() => {
                forgetPrinter();
                setSaved(null);
              }}
              className="h-11 rounded-xl px-3 text-xs font-bold text-red-500"
            >
              {t("forget")}
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-black uppercase tracking-wide opacity-60">{title}</h2>
      {children}
    </section>
  );
}

function DeviceRow({ d, onPick, mine, t }: { d: BtDevice; onPick: () => void; mine?: boolean; t: ReturnType<typeof useTranslations> }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 text-start transition-all active:scale-[0.99]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600)">
        <Printer size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black">{d.name || t("unnamed")}</span>
        <span className="block truncate text-[11px] opacity-50" dir="ltr">{d.address}</span>
      </span>
      {mine && <span className="shrink-0 rounded-full bg-(--brand-500)/15 px-2 py-0.5 text-[10px] font-black text-(--brand-600)">{t("lastUsed")}</span>}
      {d.bonded && !mine && <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-600">{t("pairedBadge")}</span>}
    </button>
  );
}

function Centered({
  icon,
  title,
  body,
  sub,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  sub?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-4 py-8 text-center">
      <div className="text-(--brand-600)">{icon}</div>
      <h2 className="text-lg font-black">{title}</h2>
      {body && <p className="text-sm leading-6 opacity-75">{body}</p>}
      {sub && <p className="text-xs font-bold opacity-50">{sub}</p>}
      {actions && <div className="mt-2 flex w-full flex-col gap-2">{actions}</div>}
    </div>
  );
}

function Primary({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-12 w-full rounded-2xl bg-gradient-brand px-4 text-sm font-black text-(--brand-contrast) shadow active:scale-[0.99]">
      {children}
    </button>
  );
}

function Secondary({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-12 w-full rounded-2xl border border-(--border-default) px-4 text-sm font-bold active:scale-[0.99]">
      {children}
    </button>
  );
}
