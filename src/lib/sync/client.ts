"use client";

/// Sync runner + on-device database access for the van phone.
/// All persistent state lives in OfflineDB: a real SQLite file
/// (`distribuili-van.db`) inside the APK, localStorage on web/PWA.
/// The APK embeds its device token once (Settings → paste, or ?device= URL).

import { db, type OutboxRow } from "./offline-db";

const SNAP_KEY = "dili_snapshot_v1";
const TOKEN_KEY = "dili_device_token";
const SYNC_URL_KEY = "dili_sync_url";
const VAN_KEY = "dili_van_id";
const LAST_KEY = "dili_last_sync";

export type QueuedOp = { opId: string; kind: string; payload: Record<string, unknown>; ts: number; error?: string };

export type SnapshotProduct = {
  id: string;
  name: string;
  reference: string | null;
  barcode: string | null;
  colisage: string | null;
  salePrice: number;
  categoryId: string | null;
  images: string[];
  baseUnit: { id: string; name: string } | null;
  conversions: Array<{ unitId: string; name: string; factor: number; barcode: string | null }>;
  tierPrices: Array<{ tierId: string; price: number }>;
};

export type SnapshotClient = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  wilayaCode: number | null;
  tierId: string | null;
  balance: number;
  creditLimit: number;
};

export type SnapshotCompany = {
  name: string;
  phone: string | null;
  address: string | null;
  rc: string | null;
  nif: string | null;
  ai: string | null;
  logoUrl: string | null;
} | null;

export type VanSnapshot = {
  serverTime?: string;
  company: SnapshotCompany;
  settings: {
    remiseEnabled: boolean;
    creditSalesEnabled: boolean;
    qrStrictMode: boolean;
    oversellAllowed: boolean;
    expiryEnabled: boolean;
    transferConfirmRequired: boolean;
    pieceSalesEnabled: boolean;
  };
  products: SnapshotProduct[];
  units: Array<{ id: string; name: string }>;
  tiers: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  secteurs: Array<{ id: string; name: string; wilayaCode: number }>;
  wilayas: Array<{ code: number; nameAr: string; nameFr: string }>;
  clients: SnapshotClient[];
  stock: Array<{ productId: string; qty: number }>;
  depotStock?: Array<{ productId: string; qty: number }>;
  holds?: Array<{ productId: string; productName?: string; held: number; vanStock: number; free: number; pack?: { name: string; factor: number } | null; baseUnit?: string; orders?: Array<{ id: string; number: string; clientName: string; qty: number }> }>;
  assignedOrders?: Array<{ id: string; number: string }>;
};

function readSync(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getDeviceToken(): string | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("device");
  if (q) {
    try {
      localStorage.setItem(TOKEN_KEY, q);
    } catch {
      /* ignore */
    }
    return q;
  }
  return readSync(TOKEN_KEY);
}

export function setDeviceToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

/// Persisted sync endpoint (phone-reachable URL, e.g. https://…:3011/api/sync).
export function setSyncUrl(url: string) {
  try {
    localStorage.setItem(SYNC_URL_KEY, url);
  } catch {
    /* ignore */
  }
}

export function clearDeviceConfig() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SYNC_URL_KEY);
    localStorage.removeItem(VAN_KEY);
    localStorage.removeItem(SNAP_KEY);
    localStorage.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
}

/// Sync endpoint override for WiFi-local servers (persisted; set once via
/// `?sync=https://...` or the device screen). Defaults to same-origin.
export function getSyncUrl(): string {
  if (typeof window === "undefined") return "/api/sync";
  const q = new URLSearchParams(window.location.search).get("sync");
  if (q) {
    try {
      localStorage.setItem(SYNC_URL_KEY, q);
    } catch {
      /* ignore */
    }
    return q;
  }
  return readSync(SYNC_URL_KEY) || "/api/sync";
}

export function getVanId(): string | null {
  return typeof window === "undefined" ? null : readSync(VAN_KEY);
}

export function setVanId(id: string) {
  try {
    localStorage.setItem(VAN_KEY, id);
  } catch {
    /* ignore */
  }
}

export async function getOutbox(): Promise<OutboxRow[]> {
  if (typeof window === "undefined") return [];
  return db.outboxList();
}

export async function pendingCount(): Promise<number> {
  return (await getOutbox()).length;
}

export async function failedCount(): Promise<number> {
  return (await getOutbox()).filter((o) => o.error).length;
}

export async function queueOp(kind: string, payload: Record<string, unknown>): Promise<string> {
  const opId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const row: OutboxRow = { opId, kind, payload, ts: Date.now(), attempts: 0, nextRetryAt: 0 };
  await db.outboxPut(row);
  return opId;
}

function parseSnapshot(raw: string | null): VanSnapshot | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VanSnapshot;
  } catch {
    return null;
  }
}

export async function getSnapshot(): Promise<unknown | null> {
  if (typeof window === "undefined") return null;
  return parseSnapshot(await db.kvGet(SNAP_KEY));
}

export async function getVanSnapshot(): Promise<VanSnapshot | null> {
  if (typeof window === "undefined") return null;
  return parseSnapshot(await db.kvGet(SNAP_KEY));
}

export function getLastSync(): string | null {
  return typeof window === "undefined" ? null : readSync(LAST_KEY);
}

/// Warm the image cache for the van catalog so product photos render
/// fully offline. Best-effort, never blocks the sync result.
async function precacheSnapshotImages(
  snap: VanSnapshot,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  try {
    if (!("caches" in window)) return;
    const urls = [
      ...new Set(
        snap.products
          .flatMap((p) => p.images ?? [])
          .filter((u) => typeof u === "string" && u.startsWith("/"))
      ),
    ].slice(0, 80);
    if (!urls.length) {
      onProgress?.(0, 0);
      return;
    }
    const cache = await caches.open("dili-img-v1");
    let done = 0;
    await Promise.all(urls.map((u) =>
      cache.add(u).catch(() => undefined).finally(() => {
        done += 1;
        onProgress?.(done, urls.length);
      })
    ));
  } catch {
    /* ignore */
  }
}

function backoffMs(attempts: number): number {
  return Math.min(5 * 60 * 1000, 30 * 1000 * 2 ** Math.min(attempts, 4));
}

export type SyncResult = {
  applied: Array<{ opId: string; ok: boolean; id?: string; error?: string }>;
  pulled?: unknown;
  serverTime?: string;
};

export type SyncPhase =
  | { phase: "prepare"; total: number }
  | { phase: "upload"; sent: number; total: number }
  | { phase: "apply"; done: number; total: number; failed: number }
  | { phase: "download"; products: number; clients: number }
  | { phase: "images"; done: number; total: number }
  | { phase: "done"; applied: number; failed: number; remaining: number };

export async function syncNow(onProgress?: (p: SyncPhase) => void): Promise<SyncResult> {
  const t0 = Date.now();
  try {
    return await syncNowInner(onProgress, t0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync_failed";
    const { appendHistory } = await import("./history");
    await appendHistory({
      ts: t0, ok: false, ms: Date.now() - t0,
      uploaded: 0, applied: 0, failed: 0, kinds: {}, errors: [],
      products: 0, clients: 0, images: 0, error: msg,
    });
    throw e;
  }
}

async function syncNowInner(
  onProgress: ((p: SyncPhase) => void) | undefined,
  t0: number
): Promise<SyncResult> {
  const token = getDeviceToken();
  if (!token) throw new Error("no_device_token");
  const now = Date.now();
  const outbox = await getOutbox();
  const due = outbox.filter((o) => (o.nextRetryAt ?? 0) <= now);
  onProgress?.({ phase: "prepare", total: due.length });
  onProgress?.({ phase: "upload", sent: due.length, total: due.length });
  const res = await fetch(getSyncUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceToken: token,
      locationId: getVanId(),
      ops: due.map(({ opId, kind, payload }) => ({ opId, kind, payload })),
    }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "sync_failed");
  const data = (await res.json()) as SyncResult & { pulled?: unknown; serverTime?: string };
  const okIds = new Set(data.applied.filter((a) => a.ok).map((a) => a.opId));
  const failed = new Map(data.applied.filter((a) => !a.ok).map((a) => [a.opId, a.error ?? "failed"]));
  let n = 0;
  for (const o of due) {
    if (okIds.has(o.opId)) {
      await db.outboxRemove(o.opId);
    } else if (failed.has(o.opId)) {
      const attempts = (o.attempts ?? 0) + 1;
      await db.outboxPut({
        ...o,
        attempts,
        nextRetryAt: Date.now() + backoffMs(attempts),
        error: failed.get(o.opId),
      });
    }
    // Ops the server never answered stay untouched for the next attempt.
    n += 1;
    onProgress?.({ phase: "apply", done: n, total: due.length, failed: failed.size });
  }
  const snap = (data.pulled as VanSnapshot | undefined) ?? null;
  const kindOf = new Map(due.map((o) => [o.opId, o.kind] as const));
  if (snap) {
    const products = snap.products?.length ?? 0;
    const clients = (snap as { clients?: unknown[] }).clients?.length ?? 0;
    onProgress?.({
      phase: "download",
      products,
      clients,
    });
    await db.kvSet(SNAP_KEY, JSON.stringify(data.pulled));
    let imagesTotal = 0;
    await precacheSnapshotImages(snap, (done, total) => {
      imagesTotal = total;
      onProgress?.({ phase: "images", done, total });
    });
    // Journal this sync: exactly what went up and what came down.
    const kinds: Record<string, number> = {};
    for (const id of okIds) {
      const k = kindOf.get(id) ?? "unknown";
      kinds[k] = (kinds[k] ?? 0) + 1;
    }
    const errors = [...failed.entries()].map(([opId, error]) => ({ kind: kindOf.get(opId) ?? "unknown", error }));
    const { appendHistory } = await import("./history");
    await appendHistory({
      ts: t0, ok: failed.size === 0, ms: Date.now() - t0,
      uploaded: due.length, applied: okIds.size, failed: failed.size,
      kinds, errors, products, clients, images: imagesTotal,
    });
  } else {
    onProgress?.({ phase: "download", products: 0, clients: 0 });
    onProgress?.({ phase: "images", done: 0, total: 0 });
    const kinds: Record<string, number> = {};
    for (const id of okIds) {
      const k = kindOf.get(id) ?? "unknown";
      kinds[k] = (kinds[k] ?? 0) + 1;
    }
    const errors = [...failed.entries()].map(([opId, error]) => ({ kind: kindOf.get(opId) ?? "unknown", error }));
    const { appendHistory } = await import("./history");
    await appendHistory({
      ts: t0, ok: failed.size === 0, ms: Date.now() - t0,
      uploaded: due.length, applied: okIds.size, failed: failed.size,
      kinds, errors, products: 0, clients: 0, images: 0,
    });
  }
  try {
    localStorage.setItem(LAST_KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
  const remaining = (await getOutbox()).length;
  onProgress?.({ phase: "done", applied: okIds.size, failed: failed.size, remaining });
  return data;
}
