import { Geolocation } from "@capacitor/geolocation";

/// Unified location-permission state across native (APK) and web.
/// Native: Capacitor plugin raises the Android system popup (manifest
/// permissions + built-in WebView bridge do the rest). Web: browser prompt.
export type GpsPerm = "granted" | "denied" | "prompt" | "unavailable";

function mapStatus(s: string): GpsPerm {
  if (s === "granted") return "granted";
  if (s === "denied") return "denied";
  return "prompt";
}

export async function checkGpsPermission(): Promise<GpsPerm> {
  try {
    const st = await Geolocation.checkPermissions();
    return mapStatus(st.location);
  } catch {
    // Web fallback: Permissions API (Chrome/Edge); unknown → prompt.
    try {
      const q = await (navigator as Navigator & {
        permissions?: { query(o: { name: string }): Promise<{ state: string }> };
      }).permissions?.query({ name: "geolocation" });
      if (q) return mapStatus(q.state);
    } catch {
      /* ignore */
    }
    return "geolocation" in navigator ? "prompt" : "unavailable";
  }
}

/// Ask for location (raises the system popup when in prompt state).
/// Never throws — denial is a normal answer, reported back.
export async function requestGpsPermission(): Promise<GpsPerm> {
  const cur = await checkGpsPermission();
  if (cur === "granted" || cur === "denied" || cur === "unavailable") return cur;
  try {
    const st = await Geolocation.requestPermissions();
    return mapStatus(st.location);
  } catch {
    return "prompt";
  }
}
