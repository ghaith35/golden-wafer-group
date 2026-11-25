/// New-client price default: the "normal sell price" tier.
///
/// The seed names it "détail" (retail, sortOrder 0); companies can rename or
/// reorder their tiers, so match by normalized name (accents/case ignored)
/// and fall back to the first tier — the caller passes tiers ordered by
/// sortOrder, i.e. the admin's own ordering. Returns null when there is no
/// tier at all; null also prices at the base sale price (see resolveTierPrice
/// in lib/pricing.ts), so the client never lands on wholesale by accident.
export function normalizeTierName(name: string): string {
  try {
    return (name ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z0-9 ]/gi, "");
  } catch {
    return (name ?? "").trim().toLowerCase();
  }
}

export function pickDefaultTierId(tiers: Array<{ id: string; name: string }>): string | null {
  if (!tiers.length) return null;
  return tiers.find((t) => normalizeTierName(t.name) === "detail")?.id ?? tiers[0].id;
}
