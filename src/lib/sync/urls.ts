/// Server URL normalization shared by the APK launcher, the setup QR flow,
/// and the Settings server binding.
///
/// Two shapes exist in the wild:
///   base:    https://client1.distribuili.khiatadz.com
///   legacy:  https://client1.distribuili.khiatadz.com/api/sync   (old QRs)
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
