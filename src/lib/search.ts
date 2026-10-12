/// Portable case-insensitive `contains` filter.
/// Prisma `mode: "insensitive"` throws a validation error on SQLite (offline
/// desktop builds) — and SQLite LIKE is already case-insensitive for ASCII,
/// so a plain `contains` behaves the same there.
export function containsInsensitive(value: string) {
  if (process.env.DISTRIBUILI_DB === "local") return { contains: value };
  return { contains: value, mode: "insensitive" as const };
}
