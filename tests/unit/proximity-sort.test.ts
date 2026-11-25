import { describe, expect, it } from "vitest";
import { rowDistM, sortClosestFirst } from "@/lib/clients/proximity-sort";

const road = (m: Record<string, number>) => (id: string) => m[id] ?? null;

describe("rowDistM", () => {
  it("prefers live straight-line distance over the saved road one", () => {
    // ~111 m of latitude from the anchor; saved road says 5 km.
    const d = rowDistM(
      { id: "a", gpsLat: 36.753, gpsLng: 3.058 },
      { lat: 36.752, lng: 3.058 },
      road({ a: 5000 }),
    );
    expect(d).not.toBeNull();
    expect(d!).toBeLessThan(500);
  });
  it("falls back to the saved road distance without an anchor", () => {
    expect(rowDistM({ id: "a", gpsLat: 1, gpsLng: 2 }, null, road({ a: 5000 }))).toBe(5000);
  });
  it("returns null when there is no position at all", () => {
    expect(rowDistM({ id: "a", gpsLat: null, gpsLng: null }, { lat: 0, lng: 0 }, road({}))).toBeNull();
  });
});

describe("sortClosestFirst", () => {
  it("orders nearest first, position-less rows last in stable order", () => {
    const rows = [
      { id: "nogps", gpsLat: null, gpsLng: null },
      { id: "far", gpsLat: 36.9, gpsLng: 3.1 },
      { id: "near", gpsLat: 36.753, gpsLng: 3.058 },
      { id: "nogps2", gpsLat: null, gpsLng: null },
    ];
    const out = sortClosestFirst(rows, { lat: 36.752, lng: 3.058 }, road({}));
    expect(out.map((r) => r.id)).toEqual(["near", "far", "nogps", "nogps2"]);
  });
  it("uses the road distance when the anchor is missing", () => {
    const rows = [
      { id: "b", gpsLat: null, gpsLng: null },
      { id: "a", gpsLat: null, gpsLng: null },
    ];
    const out = sortClosestFirst(rows, null, road({ a: 9000, b: 100 }));
    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
