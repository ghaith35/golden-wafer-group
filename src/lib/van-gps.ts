"use client";

/// Native-aware GPS for the van phone (no native-code change needed).
///
/// Why this exists: every caller used `navigator.geolocation`, but inside
/// the APK WebView that API fails denied-silently — MainActivity has no
/// `onGeolocationShowPrompt`, so the Android allow-location form NEVER
/// appears and the office sees "no signal" while the driver is happily
/// online. The Capacitor Geolocation plugin (already bundled: dependency +
/// native registration) talks to Android location services directly and
/// summons the REAL system permission dialog — this module routes through
/// it whenever running native, browser geolocation otherwise.
/// Nothing here ever throws; fixes give up after ~10s instead of hanging.

export type GpsFix = {
  lat: number;
  lng: number;
  accuracy: number;
  speedKmh: number | null;
};

export type GpsPerm = "granted" | "denied" | "prompt" | "unknown";

async function isNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function toFix(c: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
}): GpsFix {
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: Math.round(c.accuracy ?? 0) || 0,
    speedKmh: c.speed != null && c.speed >= 0 ? Math.round(c.speed * 3.6 * 10) / 10 : null,
  };
}

function webFix(timeoutMs: number, highAccuracy: boolean): Promise<GpsFix | null> {
  return new Promise((resolve) => {
    try {
      if (!("geolocation" in navigator)) {
        resolve(null);
        return;
      }
      let done = false;
      const to = window.setTimeout(() => {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, timeoutMs);
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (done) return;
          done = true;
          window.clearTimeout(to);
          resolve(toFix(p.coords));
        },
        () => {
          if (done) return;
          done = true;
          window.clearTimeout(to);
          resolve(null);
        },
        { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 15000 }
      );
    } catch {
      resolve(null);
    }
  });
}

/// Best fix available: native Capacitor GPS in the APK, browser geolocation
/// on the web (high accuracy first, low-accuracy retry — mirrors the old
/// inline retry so urban canyons still resolve).
export async function getGpsFix(): Promise<GpsFix | null> {
  try {
    if (await isNative()) {
      try {
        const { Geolocation } = await import("@capacitor/geolocation");
        const p = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 15000,
        });
        if (p?.coords) {
          return toFix({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            speed: p.coords.speed,
          });
        }
      } catch {
        /* fall through to the WebView API */
      }
    }
    return (await webFix(10000, true)) ?? (await webFix(15000, false));
  } catch {
    return null;
  }
}

export async function checkGpsPermission(): Promise<GpsPerm> {
  try {
    if (await isNative()) {
      const { Geolocation } = await import("@capacitor/geolocation");
      const s = await Geolocation.checkPermissions().catch(() => null);
      const v = (s as { location?: unknown } | null)?.location;
      return v === "granted" || v === "denied" || v === "prompt" ? v : "unknown";
    }
    try {
      const q = await (
        navigator as Navigator & { permissions?: { query: (d: { name: string }) => Promise<{ state: string }> } }
      ).permissions?.query({ name: "geolocation" });
      const v = q?.state;
      return v === "granted" || v === "denied" || v === "prompt" ? (v as GpsPerm) : "unknown";
    } catch {
      return "unknown";
    }
  } catch {
    return "unknown";
  }
}

/// Summons the allow-location form. Native: the REAL Android system dialog
/// (this is what the driver was never seeing). Web: no explicit request
/// API exists — a one-shot fix triggers the browser prompt instead.
/// True when a fix may now be taken. Never throws.
export async function requestGpsPermission(): Promise<boolean> {
  try {
    if (await isNative()) {
      const { Geolocation } = await import("@capacitor/geolocation");
      const r = await Geolocation.requestPermissions().catch(() => null);
      if ((r as { location?: unknown } | null)?.location === "granted") return true;
      const c = await Geolocation.checkPermissions().catch(() => null);
      return (c as { location?: unknown } | null)?.location === "granted";
    }
    return !!(await webFix(8000, false));
  } catch {
    return false;
  }
}
