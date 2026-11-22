import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PrintArgs } from "@/lib/print-ticket";
import { CUT_MODES, type CutMode } from "@/lib/escpos";

/// Web side of the native BtPrinter plugin (direct Bluetooth ESC/POS printing)
/// plus the tiny shared store that lets ANY screen's Print button open the
/// full-screen printer flow (BtPrintHost) without prop drilling.

// ── plugin contract (see android/.../BtPrinter.java) ─────────────────────────

export type BtState = {
  supported: boolean;
  enabled: boolean;
  permission: boolean;
  permanentlyDenied: boolean;
  locationNeeded: boolean;
  locationOn: boolean;
  sdk: number;
};

export type BtDevice = {
  address: string;
  name: string;
  /// 1 classic · 2 BLE-only · 3 dual-mode · 0 unknown
  type: number;
  /// Bluetooth major class — 0x600 = imaging (printers).
  major: number;
  bonded: boolean;
  /// Seen by the BLE scan / the classic discovery.
  le?: boolean;
  classic?: boolean;
  rssi?: number;
};

export type BtTransport = "classic" | "ble";

export type BtPrinterPlugin = {
  getState: () => Promise<BtState>;
  requestBt: () => Promise<BtState>;
  enableBt: () => Promise<BtState>;
  openAppSettings: () => Promise<void>;
  openLocationSettings: () => Promise<void>;
  bonded: () => Promise<{ devices: BtDevice[] }>;
  startDiscovery: () => Promise<void>;
  getDiscovered: () => Promise<{ devices: BtDevice[]; scanning: boolean }>;
  stopDiscovery: () => Promise<void>;
  pair: (o: { address: string }) => Promise<void>;
  write: (o: { address: string; data: string; transport?: BtTransport }) => Promise<{ bytes: number; transport?: string }>;
  cancel: () => Promise<void>;
};

/// Native errors reject with the bare code as the message.
export type BtErrCode =
  | "no_permission"
  | "bt_off"
  | "bt_unsupported"
  | "bad_args"
  | "busy"
  | "connect_failed"
  | "write_failed"
  | "pair_failed"
  | "pair_timeout"
  | "cancelled"
  | "render_failed"
  | "no_plugin"
  | "unknown";

const KNOWN: BtErrCode[] = [
  "no_permission",
  "bt_off",
  "bt_unsupported",
  "bad_args",
  "busy",
  "connect_failed",
  "write_failed",
  "pair_failed",
  "pair_timeout",
  "cancelled",
  "render_failed",
];

export function btErr(e: unknown): BtErrCode {
  const m = String((e as { message?: unknown } | null)?.message ?? e ?? "");
  const hit = KNOWN.find((c) => m.includes(c));
  if (hit) return hit;
  if (/not implemented|not available|UNIMPLEMENTED/i.test(m)) return "no_plugin";
  return "unknown";
}

let proxy: BtPrinterPlugin | null = null;
export function btPlugin(): BtPrinterPlugin {
  if (!proxy) proxy = registerPlugin<BtPrinterPlugin>("BtPrinter");
  return proxy;
}

function isNativeApk(): boolean {
  try {
    if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return false;
    // Desktop shell prints through window.print(), never Bluetooth.
    return (window as unknown as { distribuili?: { isDesktop?: boolean } }).distribuili?.isDesktop !== true;
  } catch {
    return false;
  }
}

let availableOnce = false;
/// True only inside an APK that actually ships the BtPrinter plugin AND the
/// phone has Bluetooth. Older APKs (no plugin) → false → the caller keeps the
/// system print dialog, so shipping this web code before the new APK is safe.
export async function btAvailable(): Promise<boolean> {
  if (availableOnce) return true;
  if (!isNativeApk()) return false;
  try {
    const s = await btPlugin().getState();
    if (!s.supported) return false;
    availableOnce = true;
    return true;
  } catch {
    return false;
  }
}

// ── remembered printer + preferences (per phone) ─────────────────────────────

const PRINTER_KEY = "gw_bt_printer";
const CUT_KEY = "gw_bt_cutmode";

export type SavedPrinter = { address: string; name: string; transport?: BtTransport };

export function loadPrinter(): SavedPrinter | null {
  try {
    const raw = localStorage.getItem(PRINTER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SavedPrinter;
    return p && typeof p.address === "string" && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(p.address) ? p : null;
  } catch {
    return null;
  }
}

export function savePrinter(p: SavedPrinter) {
  try {
    localStorage.setItem(PRINTER_KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota — printing still works, just not remembered */
  }
}

export function forgetPrinter() {
  try {
    localStorage.removeItem(PRINTER_KEY);
  } catch {
    /* ignore */
  }
}

/// How the paper is cut after a ticket (printers differ — see escpos CutMode).
/// Default "auto" (GS V 66 0). The old on/off checkbox migrates: off → "none".
export function loadCutMode(): CutMode {
  try {
    const v = localStorage.getItem(CUT_KEY);
    if (v && (CUT_MODES as string[]).includes(v)) return v as CutMode;
    if (localStorage.getItem("gw_bt_cut") === "0") return "none";
  } catch {
    /* ignore */
  }
  return "auto";
}

export function saveCutMode(m: CutMode) {
  try {
    localStorage.setItem(CUT_KEY, m);
  } catch {
    /* ignore */
  }
}

// ── shared open/close store (useSyncExternalStore) ───────────────────────────

export type BtPrintRequest = { id: number; args: PrintArgs };

let current: BtPrintRequest | null = null;
let nextId = 1;
let hosts = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function subscribeBtPrint(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}
export const getBtPrintRequest = () => current;

/// The host component mounts once in the app layout; without it (or off the
/// app layout) requestBtPrint refuses and the caller falls back to the system
/// dialog.
export function registerBtHost(): () => void {
  hosts++;
  return () => {
    hosts = Math.max(0, hosts - 1);
  };
}

/// Opens the printer flow. Returns false when it can't (no host mounted).
/// A second tap while the flow is open is swallowed (never two jobs).
export function requestBtPrint(args: PrintArgs): boolean {
  if (hosts === 0) return false;
  if (current) return true;
  current = { id: nextId++, args };
  emit();
  return true;
}

export function closeBtPrint() {
  if (!current) return;
  current = null;
  emit();
}
