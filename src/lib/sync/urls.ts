/// Server URL normalization shared by the APK launcher, the setup QR flow,
/// and the Settings server binding.
///
/// Two shapes exist in the wild:
///   base:    https://dist-client1.khiatadz.com
///   legacy:  https://dist-client1.khiatadz.com/api/sync   (old QRs)
/// Both resolve to the same origin; sync always targets <origin>/api/sync.

export function serverBaseOf(u: string): string {
  const t = (u ?? "").trim().replace(/\/+$/, "");
  const i = t.indexOf("/api/sync");
  return ((i > 0 ? t.slice(0, i) : t) || "").replace(/\/+$/, "");
}

export function syncEndpointOf(u: string): string {
  const t = (u ?? "").trim();
  if (!t || t === "/api/sync") return "/api/sync";
  if (/\/api\/sync\/?$/.test(t)) return t.replace(/\/+$/, "");
  const b = serverBaseOf(t);
  return b ? `${b}/api/sync` : "/api/sync";
}

/// Normalize a configured public domain to an absolute origin URL.
export function normalizeDomain(d: string): string {
  const t = (d ?? "").trim().replace(/\/+$/, "");
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function isPublicHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.includes(".")
      && url.hostname !== "localhost"
      && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)
      && url.pathname === "/"
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}
