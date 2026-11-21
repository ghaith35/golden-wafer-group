import { describe, expect, it } from "vitest";
import {
  canCreateSecteurIn,
  checkClientArea,
  filterAreas,
  isRestricted,
  scopeFromRows,
} from "@/lib/users/area-scope";

const wilayas = [{ code: 16 }, { code: 31 }, { code: 9 }];
const secteurs = [
  { id: "s1", wilayaCode: 16 },
  { id: "s2", wilayaCode: 16 },
  { id: "s3", wilayaCode: 31 },
  { id: "s4", wilayaCode: 31 },
];

describe("area scope", () => {
  it("no assignment = unrestricted: everything visible, anything allowed", () => {
    const scope = scopeFromRows([]);
    expect(scope).toBeNull();
    expect(isRestricted(scope)).toBe(false);
    expect(filterAreas(scope, wilayas, secteurs)).toEqual({ wilayas, secteurs });
    expect(checkClientArea(scope, {}, secteurs)).toEqual({ ok: true });
    expect(canCreateSecteurIn(scope, 9)).toBe(true);
  });

  it("whole wilaya shows every secteur of that wilaya only", () => {
    const scope = scopeFromRows([{ wilayaCode: 16, secteurId: null }]);
    const out = filterAreas(scope, wilayas, secteurs);
    expect(out.wilayas.map((w) => w.code)).toEqual([16]);
    expect(out.secteurs.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(canCreateSecteurIn(scope, 16)).toBe(true);
    expect(canCreateSecteurIn(scope, 31)).toBe(false);
  });

  it("individual secteurs show their wilaya with only those secteurs", () => {
    const scope = scopeFromRows([{ wilayaCode: 31, secteurId: "s3" }]);
    const out = filterAreas(scope, wilayas, secteurs);
    expect(out.wilayas.map((w) => w.code)).toEqual([31]);
    expect(out.secteurs.map((s) => s.id)).toEqual(["s3"]);
    // a single secteur is not a licence to add new secteurs to the wilaya
    expect(canCreateSecteurIn(scope, 31)).toBe(false);
  });

  it("mixes whole wilayas and single secteurs", () => {
    const scope = scopeFromRows([
      { wilayaCode: 16, secteurId: null },
      { wilayaCode: 31, secteurId: "s4" },
    ]);
    const out = filterAreas(scope, wilayas, secteurs);
    expect(out.wilayas.map((w) => w.code)).toEqual([16, 31]);
    expect(out.secteurs.map((s) => s.id)).toEqual(["s1", "s2", "s4"]);
  });

  it("server check: inside ok, outside refused, wilaya mandatory", () => {
    const scope = scopeFromRows([
      { wilayaCode: 16, secteurId: null },
      { wilayaCode: 31, secteurId: "s4" },
    ]);
    expect(checkClientArea(scope, { wilayaCode: 16 }, secteurs)).toEqual({ ok: true });
    expect(checkClientArea(scope, { wilayaCode: 16, secteurId: "s1" }, secteurs)).toEqual({ ok: true });
    expect(checkClientArea(scope, { wilayaCode: 31, secteurId: "s4" }, secteurs)).toEqual({ ok: true });
    // secteur-only assignment inside wilaya 31 needs the secteur
    expect(checkClientArea(scope, { wilayaCode: 31 }, secteurs)).toEqual({ ok: false, error: "area_required" });
    expect(checkClientArea(scope, { wilayaCode: 31, secteurId: "s3" }, secteurs)).toEqual({ ok: false, error: "outside_area" });
    expect(checkClientArea(scope, { wilayaCode: 9 }, secteurs)).toEqual({ ok: false, error: "area_required" });
    expect(checkClientArea(scope, {}, secteurs)).toEqual({ ok: false, error: "area_required" });
    // secteur that belongs to another wilaya than the one claimed
    expect(checkClientArea(scope, { wilayaCode: 16, secteurId: "s4" }, secteurs)).toEqual({ ok: false, error: "outside_area" });
    expect(checkClientArea(scope, { wilayaCode: 16, secteurId: "nope" }, secteurs)).toEqual({ ok: false, error: "bad_secteur" });
  });
});
