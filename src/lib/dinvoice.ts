/// Fiscal invoice maths ("D" facture, ported from Khiata): Remise on the gross
/// HT, TVA on the net HT, Timbre on the net HT. 0 hides the row.
export type DIdBlock = { rc: string; nif: string; art: string; nis: string; rib: string };
export type DSeller = DIdBlock & { name: string; descriptor: string; address: string; phone: string };
export type DOptions = {
  title: string;
  remisePercent: number;
  timbrePercent: number;
  tvaPercent: number;
  nb: string;
  seller: DSeller;
  client: DIdBlock;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const clampPercent = (n: number) => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);

export function computeDTotals(lineTotals: number[], o: { remisePercent: number; timbrePercent: number; tvaPercent: number }) {
  const remisePercent = clampPercent(o.remisePercent);
  const timbrePercent = clampPercent(o.timbrePercent);
  const tvaRate = clampPercent(o.tvaPercent);
  const after = 1 - remisePercent / 100;
  const lines = lineTotals.map((t) => ({ total: round2(t), tva: round2((t * after * tvaRate) / 100) }));
  const gross = round2(lines.reduce((s, r) => s + r.total, 0));
  const remise = round2((gross * remisePercent) / 100);
  const netHt = round2(gross - remise);
  const tva = round2((netHt * tvaRate) / 100);
  const timbre = round2((netHt * timbrePercent) / 100);
  return { lines, gross, remise, netHt, tva, timbre, ttc: round2(netHt + tva + timbre) };
}

export function emptyIds(): DIdBlock {
  return { rc: "", nif: "", art: "", nis: "", rib: "" };
}
