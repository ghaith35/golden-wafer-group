export type RuleItem = { id?: string; role: "BUY" | "GIVE"; productId: string; productName: string; imageUrl: string | null; colis: number; price?: number | null };
export type Rule = {
  id: string;
  name: string;
  /// SINGLE/PACK = free goods · PERCENT = % off the targets · PRICE = new price on the targets.
  mode: "SINGLE" | "PACK" | "PERCENT" | "PRICE";
  percent?: number | null;
  isActive: boolean;
  /// Promotion window (ISO, inclusive days). Null = open-ended.
  startsAt: string | null;
  endsAt: string | null;
  /// Free colis this rule has actually given (cancelled sales excluded).
  givenColis: number;
  items: RuleItem[];
};
export type GivenRow = {
  id: string;
  date: string;
  saleId: string;
  number: string;
  kind: string;
  client: string | null;
  product: string;
  imageUrl?: string | null;
  unit: string | null;
  qty: number;
};
