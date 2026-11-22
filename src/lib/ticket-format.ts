/// Tiny formatting helpers shared by the HTML ticket (system print) and the
/// raster ticket (direct Bluetooth print) — one source so both always agree.

export function ticketNum(v: unknown): string {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "0";
}

export function ticketShortDate(iso: unknown): string {
  try {
    const d = new Date(String(iso ?? ""));
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}
