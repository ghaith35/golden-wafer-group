/// Pure sale-site check (no prisma import — unit-testable).
/// Distance between the phone's GPS fix at sale time and the client's
/// registered position. Null when either side is missing (denied fix,
/// offline, or client never located) — never a zero that reads as "at".

export function computeSaleDistM(
  saleLat: unknown,
  saleLng: unknown,
  clientLat: unknown,
  clientLng: unknown,
  haversineM: (a: number, b: number, c: number, d: number) => number,
): number | null {
  const slat = typeof saleLat === "string" ? Number(saleLat) : (saleLat as number);
  const slng = typeof saleLng === "string" ? Number(saleLng) : (saleLng as number);
  const clat = typeof clientLat === "string" ? Number(clientLat) : (clientLat as number);
  const clng = typeof clientLng === "string" ? Number(clientLng) : (clientLng as number);
  for (const v of [slat, slng, clat, clng]) {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
  }
  if (Math.abs(slat) > 90 || Math.abs(clat) > 90 || Math.abs(slng) > 180 || Math.abs(clng) > 180) return null;
  try {
    const m = haversineM(slat, slng, clat, clng);
    return Number.isFinite(m) && m >= 0 ? Math.round(m * 10) / 10 : null;
  } catch {
    return null;
  }
}
