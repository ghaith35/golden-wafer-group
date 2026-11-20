export type RuleItem = { id?: string; role: "BUY" | "GIVE"; productId: string; productName: string; imageUrl: string | null; colis: number };
export type Rule = {
  id: string;
  name: string;
  mode: "SINGLE" | "PACK";
  isActive: boolean;
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
