/// Staff capabilities — single source of truth for UI gating. The proxy,
/// API routes and sync engine enforce the same rules server-side.
///
/// Vendeur (مندوب) runs the van flow and takes orders but never creates
/// sales tickets nor opens factures. Admin + Livreur keep both.
export function canSell(role?: string | null): boolean {
  return role === "Admin" || role === "Livreur";
}
