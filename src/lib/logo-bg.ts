/// The logo layer behind the screens can be switched off by the user (top bar
/// button). Remembered per device; applied as a class on <html> so the CSS
/// (`.gw-no-logo .gw-watermark { display: none }`) needs no re-render.

const KEY = "gw-logo-bg";
export const LOGO_BG_EVENT = "gw-logo-bg-changed";

export function getLogoOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function applyLogoClass(on: boolean): void {
  try {
    document.documentElement.classList.toggle("gw-no-logo", !on);
  } catch {
    /* no DOM */
  }
}

/// Switch it on/off, remember the choice, and tell every listener.
export function setLogoOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode: it still applies for this session */
  }
  applyLogoClass(on);
  try {
    window.dispatchEvent(new Event(LOGO_BG_EVENT));
  } catch {
    /* ignore */
  }
}
