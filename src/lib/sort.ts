/// Natural alphabetical ordering shared by every name list in the app.
///
/// Plain `a.localeCompare(b)` (and Postgres `ORDER BY name`) sort
/// "شاحنة التوزيع 10" before "شاحنة التوزيع 2" (char-by-char: "1" < "2").
/// The `numeric: true` collation option fixes that so numbered names read
/// 1, 2, … 9, 10 — true alphabetical order everywhere.
export function compareNatural(a: string, b: string, locale?: string): number {
  return a.localeCompare(b, locale, { numeric: true });
}

/// Sort a list of `{ name }` rows alphabetically (natural). Returns a new array.
export function sortByName<T extends { name: string }>(rows: T[], locale?: string): T[] {
  return [...rows].sort((x, y) => compareNatural(x.name, y.name, locale));
}
