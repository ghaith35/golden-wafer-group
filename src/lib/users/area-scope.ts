/// Admin-assigned zones for a Livreur / Pré-vendeur (wilayas + secteurs).
///
/// Storage: `UserArea` rows — secteurId null = the whole wilaya, otherwise
/// that single secteur. NO rows = unrestricted (everything is visible).
/// Pure module (no prisma / no browser APIs): shared by the API, the sync
/// engine and the phone's offline form so every layer applies one rule.

export type AreaScope = {
  /// Wilaya codes assigned as a whole (every secteur, present and future).
  wilayas: number[];
  /// Individually assigned secteurs (their wilaya shows up with only these).
  secteurs: string[];
};

type WilayaLite = { code: number };
type SecteurLite = { id: string; wilayaCode: number };

/// null = unrestricted. Rows come straight from `UserArea`.
export function scopeFromRows(rows: Array<{ wilayaCode: number; secteurId: string | null }>): AreaScope | null {
  if (!rows.length) return null;
  const wilayas = new Set<number>();
  const secteurs = new Set<string>();
  for (const r of rows) {
    if (r.secteurId) secteurs.add(r.secteurId);
    else wilayas.add(r.wilayaCode);
  }
  return { wilayas: [...wilayas], secteurs: [...secteurs] };
}

export function isRestricted(scope: AreaScope | null | undefined): scope is AreaScope {
  return !!scope && (scope.wilayas.length > 0 || scope.secteurs.length > 0);
}

/// Secteur visible under the scope (`all` = full secteur list, to map ids).
export function secteurAllowed(scope: AreaScope | null | undefined, s: SecteurLite): boolean {
  if (!isRestricted(scope)) return true;
  return scope.wilayas.includes(s.wilayaCode) || scope.secteurs.includes(s.id);
}

export function wilayaAllowed(
  scope: AreaScope | null | undefined,
  code: number,
  secteurs: SecteurLite[],
): boolean {
  if (!isRestricted(scope)) return true;
  if (scope.wilayas.includes(code)) return true;
  return secteurs.some((s) => s.wilayaCode === code && scope.secteurs.includes(s.id));
}

/// Pickers: only the assigned wilayas / secteurs (everything when unrestricted).
export function filterAreas<W extends WilayaLite, S extends SecteurLite>(
  scope: AreaScope | null | undefined,
  wilayas: W[],
  secteurs: S[],
): { wilayas: W[]; secteurs: S[] } {
  if (!isRestricted(scope)) return { wilayas, secteurs };
  const okSecteurs = secteurs.filter((s) => secteurAllowed(scope, s));
  const okWilayas = wilayas.filter((w) => wilayaAllowed(scope, w.code, secteurs));
  return { wilayas: okWilayas, secteurs: okSecteurs };
}

/// May the person add a brand-new secteur inside this wilaya? Only when the
/// whole wilaya is theirs (an individually-assigned secteur is not a licence
/// to extend the wilaya).
export function canCreateSecteurIn(scope: AreaScope | null | undefined, wilayaCode: number): boolean {
  if (!isRestricted(scope)) return true;
  return scope.wilayas.includes(wilayaCode);
}

export type AreaCheck = { ok: true } | { ok: false; error: "area_required" | "outside_area" | "bad_secteur" };

/// Server-side gate for a new client (API + offline sync replay).
/// Unrestricted → always ok. Restricted → a wilaya is mandatory, it and the
/// secteur must be inside the assignment, and a secteur is mandatory unless
/// the whole wilaya is assigned.
export function checkClientArea(
  scope: AreaScope | null | undefined,
  input: { wilayaCode?: number | null; secteurId?: string | null },
  secteurs: SecteurLite[],
): AreaCheck {
  if (!isRestricted(scope)) return { ok: true };
  const sec = input.secteurId ? secteurs.find((s) => s.id === input.secteurId) : undefined;
  if (input.secteurId && !sec) return { ok: false, error: "bad_secteur" };
  const wilayaCode = input.wilayaCode ?? sec?.wilayaCode ?? null;
  if (wilayaCode == null) return { ok: false, error: "area_required" };
  if (sec && sec.wilayaCode !== wilayaCode) return { ok: false, error: "outside_area" };
  const whole = scope.wilayas.includes(wilayaCode);
  if (!whole && !sec) return { ok: false, error: "area_required" };
  if (sec && !secteurAllowed(scope, sec)) return { ok: false, error: "outside_area" };
  return { ok: true };
}
