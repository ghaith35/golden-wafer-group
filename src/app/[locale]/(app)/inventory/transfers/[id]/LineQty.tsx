"use client";

import { packBreakdown } from "@/components/products/UnitQty";

export type LineConv = {
  unitId: string;
  factor: unknown;
  unit: { name: string };
};

/// Transfer line quantities in colisage (packs) with base units underneath:
/// "15 كرتون" + "360 قطعة" instead of a bare "360".
/// Falls back to plain base quantities when the product has no packs.
export function LineQty({
  declared,
  confirmed,
  conversions,
  baseName,
}: {
  declared: unknown;
  confirmed: unknown;
  conversions: LineConv[];
  baseName: string;
}) {
  const convs = conversions.map((c) => ({ unitId: c.unitId, factor: Number(c.factor) }));
  const uname = (id: string) => conversions.find((c) => c.unitId === id)?.unit.name ?? "";
  const hasPacks = convs.some((c) => c.factor > 1);
  const dq = Number(declared);
  const cq = confirmed != null ? Number(confirmed) : null;
  if (!hasPacks) {
    return (
      <span>
        {String(declared)}
        {cq != null && <span className="opacity-60"> → {String(confirmed)}</span>}
      </span>
    );
  }
  const pd = packBreakdown(dq, convs, uname, baseName);
  const pc = cq != null ? packBreakdown(cq, convs, uname, baseName) : null;
  return (
    <span>
      <span className="block font-black">
        {pd}
        {pc != null && pc !== pd && <span> → {pc}</span>}
      </span>
      <span className="block text-[11px] font-semibold opacity-60">
        {String(declared)}
        {cq != null && <span> → {String(confirmed)}</span>}
        {baseName ? ` ${baseName}` : ""}
      </span>
    </span>
  );
}
