/// Interface zoom shared by the top-bar − / 100% / + buttons AND the keyboard
/// (Ctrl/Cmd +, −, 0). One store, so the two can never disagree.
///
/// - Desktop shell: native Chromium zoom through the preload bridge — exactly
///   like browser zoom, so vh/dvh layouts, px sizes and fixed bars all scale
///   correctly.
/// - Web / APK / older desktop shells without the bridge: CSS `zoom` on <html>
///   (same approach as ZZ Sanitaire) — everything scales, px included.
///   globals.css divides vh-based shells by --ui-zoom so short pages never
///   gain a phantom scrollbar.
/// Persisted per device (percent, same key the old control used).

export const ZOOM_KEY = "dili_ui_zoom";
export const ZOOM_MIN = 70;
export const ZOOM_MAX = 150;
export const ZOOM_STEP = 10;
export const ZOOM_DEFAULT = 100;

export function clampZoom(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n / ZOOM_STEP) * ZOOM_STEP));
}

/// Next level one step up/down, clamped to the range.
export function stepZoom(current: number, dir: 1 | -1): number {
  return clampZoom(current + dir * ZOOM_STEP);
}

type Bridge = { setZoom?: (pct: number) => Promise<unknown> };
const bridge = (): Bridge | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { distribuili?: Bridge }).distribuili;

let current: number | null = null;
const listeners = new Set<() => void>();

function read(): number {
  try {
    const raw = window.localStorage.getItem(ZOOM_KEY);
    if (raw !== null) return clampZoom(raw);
  } catch {
    /* private mode */
  }
  return ZOOM_DEFAULT;
}

function apply(pct: number) {
  const b = bridge();
  const root = document.documentElement;
  root.style.fontSize = "";
  if (b?.setZoom) {
    root.style.zoom = "";
    root.removeAttribute("data-ui-zoom");
    root.style.removeProperty("--ui-zoom");
    void b.setZoom(pct).catch(() => {});
  } else if (pct === ZOOM_DEFAULT) {
    root.style.zoom = "";
    root.removeAttribute("data-ui-zoom");
    root.style.removeProperty("--ui-zoom");
  } else {
    root.style.zoom = String(pct / 100);
    root.setAttribute("data-ui-zoom", String(pct));
    root.style.setProperty("--ui-zoom", String(pct / 100));
  }
}

export function getZoom(): number {
  if (typeof window === "undefined") return ZOOM_DEFAULT;
  if (current === null) current = read();
  return current;
}

export function subscribeZoom(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setZoom(pct: number) {
  const next = clampZoom(pct);
  current = next;
  try {
    window.localStorage.setItem(ZOOM_KEY, String(next));
  } catch {
    /* private mode */
  }
  apply(next);
  listeners.forEach((l) => l());
}

export const zoomIn = () => setZoom(stepZoom(getZoom(), 1));
export const zoomOut = () => setZoom(stepZoom(getZoom(), -1));
export const zoomReset = () => setZoom(ZOOM_DEFAULT);

/// Keyboard: Ctrl/Cmd + "+" / "=" (zoom in) · "−" (out) · "0" (reset),
/// including the numpad. Returns the unsubscribe.
export function installZoomKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key;
    if (k === "+" || k === "=" || k === "Add") zoomIn();
    else if (k === "-" || k === "_" || k === "Subtract") zoomOut();
    else if (k === "0") zoomReset();
    else return;
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
