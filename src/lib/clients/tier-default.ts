/// New-client price default: the "normal sell price" tier.
///
/// Tiers are usually named "détail" or "Prix de détail" (retail — the seed
/// default, sortOrder 0); companies can rename or reorder their tiers, so
/// match by normalized name (accents/case ignored, last word must be
/// "detail") and fall back to the first tier — the caller passes tiers
/// ordered by sortOrder, i.e. the admin's own ordering. Returns null when
/// there is no tier at all; null also prices at the base sale price (see
/// resolveTierPrice in lib/pricing.ts), so the client never lands on
/// wholesale by accident.
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

/// True for "détail", "Prix de détail", "DETAIL", … — never for
/// "Prix de gros" / "Prix super gros".
export function isDetailTierName(name: string): boolean {
  const words = normalizeTierName(name).split(" ").filter(Boolean);
  return words.length > 0 && words[words.length - 1] === "detail";
}

export function pickDefaultTierId(tiers: Array<{ id: string; name: string }>): string | null {
  if (!tiers.length) return null;
  return tiers.find((t) => isDetailTierName(t.name))?.id ?? tiers[0].id;
}
