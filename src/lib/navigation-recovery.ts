export const RECOVERY_KEY = "dili_navigation_recovery_v1";
export const LAST_PAGE_KEY = "dili_last_working_page_v1";
const RETRY_WINDOW = 10 * 60 * 1000;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function recoveryDestination(pathname: string, storage: Storage, now = Date.now()): string | null {
  const locale = /^\/(ar|fr|en)(?:\/|$)/.exec(pathname)?.[1] ?? "ar";
  let attempts: { started: number; paths: string[] } = { started: now, paths: [] };
  try {
    const saved = JSON.parse(storage.getItem(RECOVERY_KEY) ?? "null");
    if (saved && Number.isFinite(saved.started) && now - saved.started < RETRY_WINDOW && Array.isArray(saved.paths)) {
      attempts = { started: saved.started, paths: saved.paths.filter((p: unknown) => typeof p === "string") };
    }
    if (!attempts.paths.includes(pathname)) {
      attempts.paths.push(pathname);
      storage.setItem(RECOVERY_KEY, JSON.stringify(attempts));
      return pathname;
    }
    const previous = storage.getItem(LAST_PAGE_KEY);
    const day = new RegExp(`^/${locale}/livreur/(\\d{4}-\\d{1,2}-\\d{1,2})(?:/|$)`).exec(pathname)?.[1];
    const home = pathname.startsWith(`/${locale}/livreur`)
      ? `/${locale}/livreur${day ? `/${day}/dashboard` : ""}`
      : `/${locale}/dashboard`;
    const target = [previous, home].find((p) => p && p.startsWith(`/${locale}/`) && !p.includes("?") && !p.includes("#") && !p.includes("\\") && p !== pathname && !attempts.paths.includes(p));
    if (!target) return null;
    // Reserve the destination too, so two failing pages cannot bounce forever.
    attempts.paths.push(target);
    storage.setItem(RECOVERY_KEY, JSON.stringify(attempts));
    return target;
  } catch {
    // Without storage there is no reliable way to bound automatic reloads.
    return null;
  }
}
