"use client";

import type { AreaScope } from "@/lib/users/area-scope";
import { parseClientScan } from "@/lib/clients/qr";

/// Sync runner + on-device database access for the van phone.
/// All persistent state lives in OfflineDB: a real SQLite file
/// (`distribuili-van.db`) inside the APK, localStorage on web/PWA.
/// The APK embeds its device token once (Settings → paste, or ?device= URL).

import { db, type OutboxRow } from "./offline-db";
import { sortOutbox } from "./offline-rules";
import type { ThreePackRuleLite } from "@/lib/threepack/match";

const SNAP_KEY = "dili_snapshot_v1";
const SKEW_KEY = "dili_clock_skew_v1";
/// Server sale details cached on successful online opens (bounded), so a
/// synced facture/order still OPENS offline — deliver/cancel/print/share all
/// resolve against a real server id. Stale by design (banner shown); the
/// ops themselves stay safe (deliver guards CONFIRMED-only, cancel is
/// idempotent, edits stay online-only).
const DETAIL_PREFIX = "dili_detail_v1:";
const DETAIL_MAX = 50;
export async function saveCachedDetail(id: string, data: unknown): Promise<void> {
  try {
    if (typeof window === "undefined" || !id) return;
    localStorage.setItem(`${DETAIL_PREFIX}${id}`, JSON.stringify({ ts: Date.now(), data }));
    // Bound the cache: drop the oldest entries past the cap.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DETAIL_PREFIX)) keys.push(k);
    }
    if (keys.length > DETAIL_MAX) {
      const aged = keys
        .map((k) => {
          try {
            return { k, ts: Number((JSON.parse(localStorage.getItem(k) || "") as { ts?: unknown }).ts ?? 0) };
          } catch {
            return { k, ts: 0 };
          }
        })
        .sort((a, b) => a.ts - b.ts)
        .slice(0, keys.length - DETAIL_MAX);
      for (const { k } of aged) localStorage.removeItem(k);
    }
  } catch {
    /* cache is best-effort */
  }
}
export function getCachedDetail<T = unknown>(id: string): T | null {
  try {
    if (typeof window === "undefined" || !id) return null;
    const raw = localStorage.getItem(`${DETAIL_PREFIX}${id}`);
    if (!raw) return null;
    return (JSON.parse(raw) as { data?: T }).data ?? null;
  } catch {
    return null;
  }
}

/// Phone-clock skew flagged by the last successful sync (minutes, signed).
/// Null = clock sane or never synced. SyncModal surfaces it as a banner.
export async function getClockSkew(): Promise<{ skewMin: number; ts: number } | null> {
  try {
    const raw = await db.kvGet(SKEW_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { skewMin?: unknown; ts?: unknown };
    if (typeof p.skewMin !== "number" || typeof p.ts !== "number") return null;
    return { skewMin: p.skewMin, ts: p.ts };
  } catch {
    return null;
  }
}
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
  legacyQr?: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  wilayaCode: number | null;
  tierId: string | null;
  balance: number;
  creditLimit: number;
};

export type SnapshotCompany = {
  id: string;
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
    debtTrackingEnabled?: boolean;
    threePackEnabled?: boolean;
  };
  /// 3pack free-colis rules (active only), applied offline by the phone.
  threePack?: { enabled: boolean; rules: ThreePackRuleLite[] };
  products: SnapshotProduct[];
  units: Array<{ id: string; name: string }>;
  tiers: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  secteurs: Array<{ id: string; name: string; wilayaCode: number }>;
  wilayas: Array<{ code: number; nameAr: string; nameFr: string }>;
  /// Admin-assigned zones for this staffer; null/absent = unrestricted.
  areaScope?: AreaScope | null;
  clients: SnapshotClient[];
  stock: Array<{ productId: string; qty: number }>;
  depotStock?: Array<{ productId: string; qty: number }>;
  holds?: Array<{ productId: string; productName?: string; held: number; vanStock: number; free: number; pack?: { name: string; factor: number } | null; baseUnit?: string; orders?: Array<{ id: string; number: string; clientName: string; qty: number }> }>;
  assignedOrders?: Array<{ id: string; number: string }>;
  /// Declared transfers touching this van (for offline confirm/reject).
  transfers?: Array<{
    id: string; number: string; status: string; date: string;
    cashAmount: number | string | null; notes: string | null;
    fromLocationId: string; toLocationId: string;
    fromLocation: { name: string }; toLocation: { name: string };
    lines: Array<{
      id: string; declaredQty: number | string; confirmedQty: number | string | null;
      product: { id: string; name: string };
    }>;
  }>;
  vans?: Array<{ id: string; name: string; matricule: string | null }>;
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
    localStorage.removeItem(CRED_KEY);
    localStorage.removeItem(QR_KEY);
    localStorage.removeItem(UNLOCK_KEY);
    localStorage.removeItem(FAIL_KEY);
  } catch {
    /* ignore */
  }
}

// ─── Offline login credential cache (phone only) ──────────────────────────
// A driver's saved credential stays usable during an outage of any length.
// Logout, device reset, or a revocation received during sync clears it.
const CRED_KEY = "dili_offline_cred_v1";
const UNLOCK_KEY = "dili_offline_unlocked_v1";
const FAIL_KEY = "dili_offline_fails_v1";
/// QR staff badge mapped for offline unlock (drivers who always log in by
/// scan have no password to cache — without this they hit "connect once"
/// despite being logged in for weeks).
const QR_KEY = "dili_offline_qr_v1";

export type OfflineQr = {
  token: string;
  username: string;
  role: string;
  cachedAt: number;
};

const MAX_FAILS = 5;
const LOCK_MS = 30 * 1000;

export type OfflineCred = {
  username: string;
  password: string;
  role: string;
  cachedAt: number;
};

/// Minimal storage surface — injectable in tests, localStorage in prod.
export type StorageLike = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
};

function credStore(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    window.localStorage.setItem("__t", "1");
    window.localStorage.removeItem("__t");
    return window.localStorage;
  } catch {
    return null;
  }
}

function credRead<T>(store: StorageLike | null, key: string): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/// Save after a successful ONLINE login.
export function saveOfflineCred(
  username: string,
  password: string,
  role: string,
  store: StorageLike | null = credStore(),
): boolean {
  if (!store || !username.trim() || !password || role === "Admin") return false;
  try {
    store.setItem(
      CRED_KEY,
      JSON.stringify({ username: username.trim(), password, role, cachedAt: Date.now() } satisfies OfflineCred),
    );
    return true;
  } catch {
    return false;
  }
}

export function getOfflineCred(store: StorageLike | null = credStore()): OfflineCred | null {
  const c = credRead<OfflineCred>(store, CRED_KEY);
  if (!c || !c.username || !c.password) return null;
  if (!Number.isFinite(c.cachedAt)) return null;
  return c;
}

/// Wipe on logout, device reset, or server revoke.
export function clearOfflineCred(store: StorageLike | null = credStore()): void {
  try {
    store?.removeItem(CRED_KEY);
    store?.removeItem(QR_KEY);
    store?.removeItem(UNLOCK_KEY);
    store?.removeItem(FAIL_KEY);
  } catch {
    /* ignore */
  }
}

export function hasOfflineUnlock(store: StorageLike | null = credStore()): boolean {
  const t = credRead<number>(store, UNLOCK_KEY);
  return typeof t === "number" && Number.isFinite(t) && !!(getOfflineCred(store) || getOfflineQr(store));
}

/// Keep the saved staff account unlocked across offline restarts.
export function markOfflineUnlocked(store: StorageLike | null = credStore()): void {
  try {
    store?.setItem(UNLOCK_KEY, JSON.stringify(Date.now()));
    store?.removeItem(FAIL_KEY);
  } catch {
    /* ignore */
  }
}

function failInfo(store: StorageLike | null): { n: number; until: number } {
  const v = credRead<{ n: number; until: number }>(store, FAIL_KEY);
  return v && Number.isFinite(v.n) ? { n: v.n, until: v.until ?? 0 } : { n: 0, until: 0 };
}

/// Attempt an offline unlock. Returns ok, or lockedUntil (ms epoch) after
/// too many failures, or an error key when no usable cache exists.
export function tryOfflineUnlock(
  username: string,
  password: string,
  store: StorageLike | null = credStore(),
): { ok: boolean; lockedUntil?: number; error?: "no_cache" | "locked" | "bad" } {
  if (!store) return { ok: false, error: "no_cache" };
  const fails = failInfo(store);
  if (Date.now() < fails.until) return { ok: false, lockedUntil: fails.until, error: "locked" };
  const c = getOfflineCred(store);
  if (!c) return { ok: false, error: "no_cache" };
  if (c.username.toLowerCase() === username.trim().toLowerCase() && c.password === password) {
    try {
      store.setItem(UNLOCK_KEY, JSON.stringify(Date.now()));
      store.removeItem(FAIL_KEY);
    } catch {
      /* ignore */
    }
    return { ok: true };
  }
  const n = fails.n + 1;
  try {
    store.setItem(
      FAIL_KEY,
      JSON.stringify(n >= MAX_FAILS ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 }),
    );
  } catch {
    /* ignore */
  }
  return n >= MAX_FAILS ? { ok: false, lockedUntil: Date.now() + LOCK_MS, error: "locked" } : { ok: false, error: "bad" };
}

/// Save after a successful ONLINE QR login: the badge token stands in for
/// the password the driver never types. The saved badge is staff-only.
export function saveOfflineQr(
  token: string,
  username: string,
  role: string,
  store: StorageLike | null = credStore(),
): boolean {
  if (!store || !token.trim() || !username.trim() || role === "Admin") return false;
  try {
    store.setItem(
      QR_KEY,
      JSON.stringify({ token: token.trim(), username: username.trim(), role, cachedAt: Date.now() } satisfies OfflineQr),
    );
    return true;
  } catch {
    return false;
  }
}

export function getOfflineQr(store: StorageLike | null = credStore()): OfflineQr | null {
  const q = credRead<OfflineQr>(store, QR_KEY);
  if (!q || !q.token || !q.username) return null;
  if (!Number.isFinite(q.cachedAt)) return null;
  return q;
}

/// Offline unlock by staff badge scan: the scanned token must equal the one
/// cached at the last online QR login. Success opens a fresh unlock session
/// (same as a password unlock) — no typing, no connection.
export function tryOfflineQrUnlock(
  token: string,
  store: StorageLike | null = credStore(),
): { ok: true; username: string; role: string } | { ok: false; error: "no_cache" | "bad" } {
  if (!store) return { ok: false, error: "no_cache" };
  const q = getOfflineQr(store);
  if (!q) return { ok: false, error: "no_cache" };
  if (q.token === token.trim() && token.trim()) {
    try {
      store.setItem(UNLOCK_KEY, JSON.stringify(Date.now()));
      store.removeItem(FAIL_KEY);
    } catch {
      /* ignore */
    }
    return { ok: true, username: q.username, role: q.role };
  }
  return { ok: false, error: "bad" };
}

/// Resolve a scan against the server, or against the last confirmed snapshot
/// during an outage. A queued alias starts resolving after the server accepts it.
/// `day` (journée slug) restricts the online lookup to that day's tour clients.
export async function findScannedClient(text: string, companyId: string, day?: string) {
  const match = parseClientScan(text, companyId);
  if (!match) return null;
  try {
    const res = await fetch("/api/clients/qr-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qr: text, day }),
    });
    if (res.status >= 500) throw new Error("server_unreachable");
    if (!res.ok) return null;
    const row = await res.json() as Pick<SnapshotClient, "id" | "name" | "code" | "phone" | "tierId" | "balance"> | null;
    if (row) return row;
  } catch {
    const snapshot = await getVanSnapshot().catch(() => null);
    // Snapshots made by older builds lack the company id and have no aliases.
    if (snapshot && (snapshot.company?.id === companyId || (match.code && !snapshot.company?.id))) {
      const cached = snapshot.clients.find((c) => match.code ? c.code === match.code : c.legacyQr === match.legacyQr);
      if (cached) return cached;
    }
  }
  if (!match.code) return null;
  const pending = (await getPendingClients()).find((c) => c.code === match.code);
  return pending ? { ...pending, id: `pending:${pending.opId}`, balance: 0 } : null;
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

/// Origin this install currently syncs to (the bound client server).
export function currentServerOrigin(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const u = getSyncUrl();
    if (/^https?:\/\//i.test(u)) return new URL(u).origin;
    return window.location.origin;
  } catch {
    try {
      return window.location.origin;
    } catch {
      return null;
    }
  }
}

/// Distinct servers owning queued ops (normally 0–1; >1 means a rebind
/// happened with a non-empty outbox — those rows stay quarantined).
export async function pendingServers(): Promise<string[]> {
  const rows = await getOutbox();
  return [...new Set(rows.map((r) => r.server).filter((s): s is string => !!s))];
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

/// Doc ids/opIds still waiting in the outbox (created/changed offline, not
/// yet synced). Lists match their rows against this set to show an
/// "unsynced" badge. Matches create + follow-up ops (deliver/confirm/pay)
/// so a doc stays badged until EVERYTHING about it has uploaded.
export async function getUnsyncedDocKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let ops: OutboxRow[] = [];
  try {
    ops = await getOutbox();
  } catch {
    return keys;
  }
  for (const op of ops) {
    if (!/ticket|order|sale|versement|payment|return|transfer|expense|presence|stamp|declare|finish/i.test(op.kind)) continue;
    const p = op.payload ?? {};
    for (const k of ["id", "opId", "saleId", "saleOpId", "localId", "docId", "invoiceId", "transferId"]) {
      const v = p[k];
      if (typeof v === "string" && v) keys.add(v);
    }
    // Linked follow-ups reference the doc the same way.
    const link = (p.linked as Record<string, unknown> | undefined) ?? null;
    if (link) {
      for (const k of ["id", "opId", "saleId"]) {
        const v = link[k];
        if (typeof v === "string" && v) keys.add(v);
      }
    }
  }
  return keys;
}

/// Docs created offline and still waiting in the outbox (sale tickets +
/// draft orders). Lists merge these in so a queued facture is VISIBLE,
/// openable, printable and shareable before it ever reaches the server —
/// otherwise the driver thinks "it didn't save". Resolved against the
/// snapshot (names/prices) + this phone's pending clients.
export type PendingDocLine = {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  /// 3pack gift line queued offline.
  bonus?: boolean;
};
export type PendingDoc = {
  opId: string;
  kind: "ticket" | "order";
  ts: number;
  clientId: string | null;
  clientName: string | null;
  clientCode: string | null;
  clientPhone: string | null;
  paid: number;
  /// Ticket total from local lines; null for orders (server prices at sync).
  total: number | null;
  lines: PendingDocLine[];
};
export async function getPendingDocs(): Promise<PendingDoc[]> {
  let ops: OutboxRow[] = [];
  try {
    ops = await getOutbox();
  } catch {
    return [];
  }
  const wanted = ops.filter((o) => (o.kind === "ticket" || o.kind === "order") && o.payload);
  if (!wanted.length) return [];
  let snap: VanSnapshot | null = null;
  try {
    snap = await getVanSnapshot();
  } catch {
    snap = null;
  }
  let pendClients: PendingClient[] = [];
  try {
    pendClients = await getPendingClients();
  } catch {
    pendClients = [];
  }
  const prodName = new Map<string, string>();
  try {
    for (const p of snap?.products ?? []) prodName.set(p.id, p.name);
  } catch {
    /* ignore */
  }
  const cliById = new Map<string, { name?: string; code?: string; phone?: string | null }>();
  try {
    for (const c of (snap?.clients ?? []) as Array<{ id: string; name?: string; code?: string; phone?: string | null }>) {
      cliById.set(c.id, c);
    }
  } catch {
    /* ignore */
  }
  const out: PendingDoc[] = [];
  for (const o of wanted) {
    try {
      const p = o.payload as Record<string, unknown>;
      const rawLines = Array.isArray(p.lines) ? (p.lines as Array<Record<string, unknown>>) : [];
      const lines: PendingDocLine[] = rawLines.map((l) => {
        const pid = String(l.productId ?? "");
        const qty = Number(l.qty ?? 0);
        const up = Number(l.unitPrice ?? 0);
        const q = Number.isFinite(qty) ? qty : 0;
        const u = Number.isFinite(up) ? up : 0;
        return { productId: pid, name: prodName.get(pid) ?? "…", qty: q, unitPrice: u, lineTotal: Math.round(q * u * 100) / 100, ...(l.bonusRuleId ? { bonus: true } : {}) };
      });
      const cid = typeof p.clientId === "string" && p.clientId ? p.clientId : null;
      let cname: string | null = null;
      let ccode: string | null = null;
      let cphone: string | null = null;
      if (cid) {
        if (cid.startsWith("pending:")) {
          const pc = pendClients.find((c) => `pending:${c.opId}` === cid);
          if (pc) {
            cname = pc.name ?? null;
            ccode = pc.code ?? null;
            cphone = (pc.phone as string | null | undefined) ?? null;
          }
        } else {
          const sc = cliById.get(cid);
          if (sc) {
            cname = sc.name ?? null;
            ccode = sc.code ?? null;
            cphone = sc.phone ?? null;
          }
        }
      }
      const paidRaw = Number(p.paid ?? 0);
      const paid = Number.isFinite(paidRaw) ? paidRaw : 0;
      out.push({
        opId: o.opId,
        kind: o.kind as "ticket" | "order",
        ts: o.ts,
        clientId: cid,
        clientName: cname,
        clientCode: ccode,
        clientPhone: cphone,
        paid,
        total: o.kind === "ticket" ? lines.reduce((s, l) => s + l.lineTotal, 0) : null,
        lines,
      });
    } catch {
      /* skip the undecodable row — the sync engine still owns it */
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/// Server validation + offline-guard error keys are snake_case English — the
/// driver must see his own language instead. Unknown codes pass through.
const SALE_ERR_KEYS: Record<string, string> = {
  remise_disabled: "errRemise",
  qr_required: "errQr",
  insufficient_stock: "errStock",
  bonus_not_earned: "errBonus",
  cash_only: "errCashOnly",
  debt_disabled: "errDebtOff",
  client_required: "errClientReq",
  credit_limit_exceeded: "errCreditLimit",
  overpaid: "errOverpaid",
  save_failed: "errSaveFailed",
  forbidden: "errForbidden",
  bad_phone: "errBadPhone",
  duplicate_phone: "errDupPhone",
  duplicate_code: "errDupPhone",
  outside_area: "errOutsideArea",
  area_required: "errAreaRequired",
};
export function saleErrText(labels: Record<string, string>, code: string | null | undefined): string | null {
  if (!code) return null;
  const k = SALE_ERR_KEYS[code];  if (!k) return code;
  try {
    return labels[k] ?? code;
  } catch {
    return code;
  }
}
/// queueOp failure → localized message. A role-gated op (Vendeur queuing a
/// ticket/cancel from a stale cached page) reports "forbidden", never the
/// misleading "save failed".
export function queueErrText(labels: Record<string, string>, e: unknown): string {
  const code = e instanceof Error && e.message === "forbidden" ? "forbidden" : "save_failed";
  try {
    return labels[SALE_ERR_KEYS[code]] ?? code;
  } catch {
    return code;
  }
}
/// Ops the server rejected and that need attention (repair/retry/discard).
export async function failedOps(): Promise<OutboxRow[]> {
  return (await getOutbox()).filter((o) => o.error);
}

/// Reset a failed op so the next sync retries it (after the cause is fixed).
export async function retryOutboxOp(opId: string): Promise<void> {
  const rows = await db.outboxList();
  const row = rows.find((r) => r.opId === opId);
  if (!row) return;
  await db.outboxPut({ ...row, attempts: 0, nextRetryAt: 0, error: undefined, permanent: false });
}

/// Replace a failed op's payload (repair) and make it retryable.
export async function updateOutboxPayload(opId: string, payload: Record<string, unknown>): Promise<void> {
  const rows = await db.outboxList();
  const row = rows.find((r) => r.opId === opId);
  if (!row) return;
  await db.outboxPut({ ...row, payload, attempts: 0, nextRetryAt: 0, error: undefined, permanent: false });
}

/// Drop a failed op the owner chose to abandon.
export async function discardOutboxOp(opId: string): Promise<void> {
  await db.outboxRemove(opId);
}

export async function queueOp(kind: string, payload: Record<string, unknown>): Promise<string> {
  // Mandob (Vendeur) never queues facture ops nor restock declares — the UI
  // hides them, and the server rejects replays. Fail fast here so a stale
  // cached page can't silently fill the outbox (works fully offline via
  // the cached credential).
  if ((kind === "ticket" || kind === "sale-cancel" || kind === "sale-confirm" || kind === "sale-reopen" || kind === "transfer-declare") && getOfflineCred()?.role === "Vendeur") {
    throw new Error("forbidden");
  }
  const opId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const row: OutboxRow = { opId, kind, payload, ts: Date.now(), attempts: 0, nextRetryAt: 0, server: currentServerOrigin() };
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

/// Clients created on this phone but not yet synced (outbox "client" ops).
/// Merged into pickers/lists so the driver can sell to them immediately —
/// their ticket/order/payment ops reference them as `pending:<opId>`, which
/// the server resolves to the created row at sync time.
export type PendingClient = {
  opId: string;
  code: string;
  name: string;
  phone: string | null;
  tierId: string | null;
  secteurId: string | null;
};

export async function getPendingClients(): Promise<PendingClient[]> {
  let ops: OutboxRow[] = [];
  try {
    ops = await getOutbox();
  } catch {
    return [];
  }
  const out: PendingClient[] = [];
  for (const o of ops) {
    if (o.kind !== "client" || !o.payload) continue;
    const p = o.payload as Record<string, unknown>;
    const code = String(p.code ?? "").trim();
    const name = String(p.name ?? "").trim();
    if (!code || !name) continue;
    out.push({
      opId: o.opId,
      code,
      name,
      phone: typeof p.phone === "string" && p.phone.trim() ? p.phone.trim() : null,
      tierId: typeof p.tierId === "string" ? p.tierId : null,
      secteurId: typeof p.secteurId === "string" ? p.secteurId : null,
    });
  }
  return out;
}

/// Offline-aware navigation for the journée flow. Next's router.push does a
/// client-side transition that needs the network (RSC fetch) — offline it
/// fails and the WebView can land on the browser's dead error page. With no
/// connection, do a full document load instead: the service worker is
/// guaranteed to answer (cached page → bare page → offline page), never the
/// browser error. Inside the native APK every navigation is a document load:
/// it always revalidates online (so the phone runs fresh code) and always
/// serves cache offline — reliability over transition speed on the van.
export function isNative(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/// Auto-sync decision (SyncBadge heartbeat): sync without being asked when
/// there is actually something to send — online, visible, idle, ops waiting.
/// Pure (testable); the component owns the timer + busy guard.
export function shouldAutoSync(args: {
  hidden: boolean;
  online: boolean;
  busy: boolean;
  hasToken: boolean;
  pending: number;
}): boolean {
  return !args.hidden && args.online && !args.busy && args.hasToken && args.pending > 0;
}
export const AUTO_SYNC_MS = 30_000;

/// Breadcrumb of full-document pages visited this session (sessionStorage —
/// dies with the WebView, so it can never point at a stale deploy). Back
/// buttons use it to hard-load the previous warmed page: router.back() replays
/// a client-side transition that needs the network, and inside the APK Next's
/// in-memory router cache is always empty (every nav is a document load), so
/// back would break offline AND in the app. Recorded by goPage, the AppShell
/// link interceptor, and the initial page load.
const CRUMB_KEY = "dili_crumbs_v1";
const CRUMB_MAX = 25;
function readCrumbs(): string[] {
  try {
    const raw = sessionStorage.getItem(CRUMB_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function crumbPath(href: string): string | null {
  try {
    if (href.startsWith("/")) return href;
    const u = new URL(href, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}
export function recordCrumb(href: string): void {
  try {
    const path = crumbPath(href);
    if (!path) return;
    const crumbs = readCrumbs();
    if (crumbs[crumbs.length - 1] === path) return;
    crumbs.push(path);
    while (crumbs.length > CRUMB_MAX) crumbs.shift();
    sessionStorage.setItem(CRUMB_KEY, JSON.stringify(crumbs));
  } catch {
    /* never break navigation */
  }
}
/// Drop the current page and return the previous one (null when none).
/// The caller hard-loads it — the service worker answers from cache offline.
export function popCrumb(): string | null {
  try {
    const crumbs = readCrumbs();
    let cur = "";
    try {
      cur = window.location.pathname + window.location.search;
    } catch {
      /* ignore */
    }
    while (crumbs.length > 0 && crumbs[crumbs.length - 1] === cur) crumbs.pop();
    const prev = crumbs.pop() ?? null;
    try {
      sessionStorage.setItem(CRUMB_KEY, JSON.stringify(crumbs));
    } catch {
      /* ignore */
    }
    return prev;
  } catch {
    return null;
  }
}
export function goPage(router: { push: (href: string) => void }, href: string): void {
  try {
    if (typeof window !== "undefined") {
      try {
        if (isNative()) {
          recordCrumb(href);
          window.location.assign(href);
          return;
        }
      } catch { /* fall through */ }
      // serverUnreachable() covers BOTH phone-offline AND wifi-on/server-dead
      // (navigator.onLine alone misses the second — every router.push then
      // dies on an RSC fetch and the driver blames the button).
      if (serverUnreachable()) {
        recordCrumb(href);
        window.location.assign(href);
        return;
      }
    }
  } catch { /* fall through to router */ }
  router.push(href);
}

/// Live server reachability (the "live transfer" signal). navigator.onLine
/// only knows the PHONE has a network — wifi on + shop server dead still reads
/// "online", and every client-side transition then dies on its RSC fetch.
/// This heartbeat learns the truth (relative /api/sync health — same origin,
/// no auth, no CORS) and goPage / the link interceptor / the offline dialog
/// steer around a dead server instead of into it. Unknown or stale = assume
/// up (fast path).
const REACH_KEY = "dili_server_reach_v1";
const PROBE_EVERY_MS = 20000;
const REACH_FRESH_MS = 45000;
let probeStarted = false;

/// Transition subscribers (offline dialog, sync pill…): notified whenever the
/// known server state FLIPS. In-memory per tab; the stored row below keeps
/// late mounters honest. Callbacks must never throw (guarded here anyway).
type ReachCb = (reachable: boolean) => void;
const reachSubs = new Set<ReachCb>();
let lastReach: boolean | null = null;
function emitReach(ok: boolean): void {
  if (lastReach === ok) return;
  lastReach = ok;
  for (const cb of [...reachSubs]) {
    try {
      cb(ok);
    } catch {
      /* never break the probe */
    }
  }
}
export function subscribeReachability(cb: ReachCb): () => void {
  reachSubs.add(cb);
  return () => {
    reachSubs.delete(cb);
  };
}
/// Best-known state right now: live probe memory first, stored row fallback.
export function isServerReachable(): boolean {
  if (lastReach !== null) return lastReach;
  return !serverUnreachable();
}
function storeReach(ok: boolean): void {
  try {
    sessionStorage.setItem(REACH_KEY, JSON.stringify({ ok, ts: Date.now() }));
  } catch {
    /* private mode */
  }
  emitReach(ok);
}
function readReach(): { ok: boolean; ts: number } | null {
  try {
    const raw = sessionStorage.getItem(REACH_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { ok?: unknown; ts?: unknown };
    if (typeof p.ts !== "number") return null;
    return { ok: p.ok === true, ts: p.ts };
  } catch {
    return null;
  }
}
export function serverUnreachable(): boolean {
  try {
    if (typeof window === "undefined" || window.navigator?.onLine === false) return true;
    const r = readReach();
    // No sighting yet, or older than the heartbeat horizon: the server was
    // reachable when this page loaded (else the page itself wouldn't be here
    // — every entry is a document load), so assume up and stay fast.
    if (!r || Date.now() - r.ts > REACH_FRESH_MS) return false;
    return !r.ok;
  } catch {
    return false;
  }
}
async function probeOnce(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      // Only sub-500 answers mean "server alive": a dead tunnel RESOLVES
      // with Cloudflare's 530 error page (fetch does NOT reject), which
      // must count as DOWN — otherwise every phone reports reachable
      // while staring at Error 1033. 401/404/405 = the server answered.
      const res = await fetch("/api/sync", { method: "GET", cache: "no-store", credentials: "omit", signal: ctrl.signal });
      storeReach(res.status < 500);
    } catch {
      storeReach(false);
    } finally {
      clearTimeout(t);
    }
  } catch {
    /* never break the page */
  }
}
/// Manual re-check (the offline dialog's "retry" button): resolves with the
/// fresh verdict so the caller can close the dialog without waiting a tick.
export async function probeReachabilityNow(): Promise<boolean> {
  try {
    await probeOnce();
  } catch {
    /* verdict below is best-effort */
  }
  return isServerReachable();
}
export function startReachabilityProbe(): void {
  try {
    if (probeStarted || typeof window === "undefined") return;
    probeStarted = true;
    void probeOnce();
    window.addEventListener("online", () => void probeOnce());
    // Browser-reported loss is instant truth — don't wait for the next tick.
    window.addEventListener("offline", () => storeReach(false));
    document.addEventListener("visibilitychange", () => {
      try {
        if (!document.hidden) void probeOnce();
      } catch {
        /* ignore */
      }
    });
    setInterval(() => {
      try {
        if (!document.hidden) void probeOnce();
      } catch {
        /* ignore */
      }
    }, PROBE_EVERY_MS);
  } catch {
    /* never break the page */
  }
}

/// Pre-fetch the lazy JS chunks the journée needs while OFFLINE (QR decode
/// for the camera fallback + gallery, ticket QR print, native share/print).
/// Dynamic imports bypass the page cache — a phone that never fetched a chunk
/// while online (or lost it to an SW-version cache purge) gets a dead camera
/// and dead printing the first time it goes offline. These run through the
/// service worker's static branch, so one online fetch caches them for later.
/// Fire-and-forget: failures are silently ignored.
/// Keep in sync with FirstRunWarmup's media step (same set, verified there).
export function warmOfflineChunks(): void {
  try {
    if (typeof window === "undefined" || window.navigator?.onLine === false) return;
    void import("jsqr").catch(() => {});
    void import("qrcode").catch(() => {});
    void import("@capacitor/core").catch(() => {});
    void import("@capacitor/browser").catch(() => {});
    void import("@capacitor/share").catch(() => {});
    void import("@capacitor/filesystem").catch(() => {});
    // A4 facture PDF builder (+ its jsPDF chunk) and the Amiri fonts it
    // shapes Arabic with — the Share button must work fully offline.
    void import("@/lib/pdf/ticketPdf").catch(() => {});
    // Offline map shells (leaflet + tiles layer): the carte page dynamic-
    // imports these — unwarmed, it dies with a chunk error offline.
    void import("@/components/map/TourneeMap").catch(() => {});
    void import("@/components/map/VansMap").catch(() => {});
    for (const f of ["/fonts/amiri-regular.ttf", "/fonts/amiri-bold.ttf"]) {
      fetch(f, { cache: "force-cache" }).catch(() => {});
    }
  } catch {
    /* never break the page */
  }
}

/// Service-worker cache generation the offline warmup is verified against.
/// MUST match VERSION in public/sw.js (a worker upgrade purges every older
/// cache — phones must re-warm, and the first-run flag below carries this
/// so a stale "done" from a previous generation never counts). Enforced by
/// tests/unit/offline-warmup.test.ts.
export const WARM_SW_VERSION = "dili-sw-v12";

/// Warm the service-worker's page cache for the given same-origin document
/// URLs while online, so the journée loop keeps working fully offline.
/// Fire-and-forget: failures (offline already, 404, …) are silently ignored.
/// The Accept header is what lets the SW recognize these as page documents.
export function prefetchPages(urls: string[]): void {
  try {
    if (typeof window === "undefined" || window.navigator?.onLine === false) return;
    for (const u of urls) {
      fetch(u, { credentials: "same-origin", headers: { Accept: "text/html" } }).catch(() => {});
    }
  } catch { /* never break the page */ }
}

/// Only cache real documents the signed-in role can open. /livreur is a
/// server redirect, and the delivery queue has its own server-rendered query.
export function warmManifest(locale: string, day: string, role?: string): string[] {
  const base = `/${locale}/livreur/${day}`;
  const pages = [
    `/${locale}/login`,
    base,
    `${base}/start`,
    `${base}/dashboard`,
    `${base}/commande`,
    `${base}/commandes`,
    `${base}/expenses`,
    `${base}/stock`,
    `${base}/clients/new`,
  ];
  if (role !== "Vendeur") {
    pages.push(`${base}/vente`, `${base}/factures`, `${base}/demande`, `${base}/commandes?ready=1`);
  }
  return pages;
}
export function warmJourneePages(locale: string, day: string, role?: string): void {
  try {
    if (role) void prepareOfflinePages(locale, day, role);
    else prefetchPages(warmManifest(locale, day));
    try {
      prefetchPages([window.location.href]);
    } catch { /* never break the page */ }
    // Same trip: fill the static cache with the lazy chunks the journée
    // needs offline (QR camera fallback, ticket print/share).
    warmOfflineChunks();
  } catch { /* never break the page */ }
}

/// Fetching a document as HTML does not fetch its route-specific JS or CSS.
/// Store those dependencies explicitly before counting the document as ready.
export async function warmAndVerify(urls: string[]): Promise<Array<{ url: string; ok: boolean }>> {
  const failed = () => urls.map((url) => ({ url, ok: false }));
  try {
    if (typeof window === "undefined" || navigator.onLine === false) return failed();
    const worker = navigator.serviceWorker;
    if (!worker) return failed();
    const [pages, assets] = await Promise.all([
      caches.open(`${WARM_SW_VERSION}-pages`),
      caches.open(`${WARM_SW_VERSION}-static`),
    ]);
    const origin = window.location.origin;
    const dependencies = new Map<string, Promise<void>>();

    async function cacheAsset(url: URL) {
      if (await assets.match(url.href)) return;
      const res = await fetch(url.href);
      const contentType = res.headers.get("content-type") ?? "";
      const expected = url.pathname.endsWith(".css") ? "css" : "javascript";
      if (!res.ok || res.redirected || !contentType.includes(expected)) {
        throw new Error("offline_asset_unavailable");
      }
      await assets.put(url.href, res);
    }

    const results: Array<{ url: string; ok: boolean }> = [];
    for (const url of urls) {
      try {
        const target = new URL(url, origin);
        const res = await fetch(target.href, {
          credentials: "same-origin",
          headers: { Accept: "text/html" },
          redirect: "error",
        });
        if (!res.ok || res.url !== target.href || !res.headers.get("content-type")?.includes("text/html")) {
          results.push({ url, ok: false });
          continue;
        }
        const document = new DOMParser().parseFromString(await res.clone().text(), "text/html");
        const refs = document.querySelectorAll("script[src], link[rel=stylesheet][href], link[rel=modulepreload][href], link[rel=preload][as=script][href], link[rel=preload][as=style][href]");
        const required: Promise<void>[] = [];
        for (const ref of refs) {
          const asset = new URL(ref.getAttribute("src") ?? ref.getAttribute("href")!, target);
          if (asset.origin !== origin || !asset.pathname.startsWith("/_next/static/")) continue;
          let saved = dependencies.get(asset.href);
          if (!saved) {
            saved = cacheAsset(asset);
            dependencies.set(asset.href, saved);
          }
          required.push(saved);
        }
        // A Next page needs its runtime. An HTML error or placeholder is not ready.
        if (required.length === 0) {
          results.push({ url, ok: false });
          continue;
        }
        await Promise.all(required);
        await pages.put(target.href, res);
        results.push({ url, ok: true });
      } catch {
        results.push({ url, ok: false });
      }
    }
    return worker.controller ? results : failed();
  } catch {
    return failed();
  }
}

const offlineWarmups = new Map<string, Promise<Array<{ url: string; ok: boolean }>>>();

export function prepareOfflinePages(locale: string, day: string, role: string) {
  const key = JSON.stringify([locale, day, role]);
  const pending = offlineWarmups.get(key);
  if (pending) return pending;
  const warmup = warmAndVerify(warmManifest(locale, day, role)).finally(() => offlineWarmups.delete(key));
  offlineWarmups.set(key, warmup);
  return warmup;
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

export function backoffMs(attempts: number): number {
  return Math.min(5 * 60 * 1000, 30 * 1000 * 2 ** Math.min(attempts, 4));
}

export type WebUpdateInfo = {
  available: boolean;
  buildId: string;
  force: boolean;
  nativeRequired: boolean;
  minNative: number;
};

export type SyncResult = {
  applied: Array<{ opId: string; ok: boolean; id?: string; error?: string; permanent?: boolean }>;
  pulled?: unknown;
  serverTime?: string;
  /// Set when the server moved to a newer web build (or mandates a native
  /// floor): the UI prompts once, the user validates, the app restarts updated.
  webUpdate?: WebUpdateInfo | null;
};

export type SyncPhase =
  | { phase: "prepare"; total: number }
  | { phase: "upload"; sent: number; total: number }
  | { phase: "apply"; done: number; total: number; failed: number }
  | { phase: "download"; products: number; clients: number }
  | { phase: "images"; done: number; total: number }
  | { phase: "done"; applied: number; failed: number; remaining: number };

export async function syncNow(onProgress?: (p: SyncPhase) => void): Promise<SyncResult> {
  // Single-flight: auto-flush (SyncBadge), the manual modal and the dashboard
  // tile can all fire at once — they must never run two syncs concurrently
  // (that was the source of duplicate documents).
  if (inFlight) return inFlight;
  const run = (async () => {
    const t0 = Date.now();
    try {
      // Cross-tab lock when available (one sync per device across all tabs).
      const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }) : undefined;
      if (nav?.locks?.request) {
        return await nav.locks.request("dili-sync", { mode: "exclusive" }, () => syncNowInner(onProgress, t0));
      }
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
  })().finally(() => {
    if (inFlight === run) inFlight = null;
  });
  inFlight = run;
  return run;
}
let inFlight: Promise<SyncResult> | null = null;

async function syncNowInner(
  onProgress: ((p: SyncPhase) => void) | undefined,
  t0: number
): Promise<SyncResult> {
  const token = getDeviceToken();
  if (!token) throw new Error("no_device_token");
  const now = Date.now();
  const outbox = await getOutbox();
  // Only this server's ops go up. Rows tagged for another server stay
  // quarantined (rebind with a non-empty outbox); legacy untagged rows are
  // grandfathered to the current server.
  const target = currentServerOrigin();
  const due = outbox.filter(
    (o) => (o.nextRetryAt ?? 0) <= now && (!o.server || !target || o.server === target)
  );
  // Send in dependency order (client before its ticket, declare before confirm).
  const ordered = sortOutbox(due);
  onProgress?.({ phase: "prepare", total: ordered.length });
  onProgress?.({ phase: "upload", sent: ordered.length, total: ordered.length });
  const res = await fetch(getSyncUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceToken: token,
      locationId: getVanId(),
      ops: ordered.map(({ opId, kind, payload, ts }) => ({ opId, kind, payload, occurredAt: ts })),
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))).error ?? "sync_failed";
    // Phone revoked or driver deactivated server-side: forget the offline
    // credential too, so the next unlock forces a fresh online login.
    if (res.status === 401 && (err === "bad_device" || err === "device_no_user" || err === "user_inactive")) {
      try {
        clearOfflineCred();
      } catch {
        /* ignore */
      }
    }
    throw new Error(err);
  }
  const data = (await res.json()) as SyncResult & { pulled?: unknown; serverTime?: string };
  const okIds = new Set(data.applied.filter((a) => a.ok).map((a) => a.opId));
  const failed = new Map(
    data.applied
      .filter((a) => !a.ok)
      .map((a) => [a.opId, { error: a.error ?? "failed", permanent: Boolean(a.permanent) }] as const),
  );
  let n = 0;
  for (const o of due) {
    if (okIds.has(o.opId)) {
      await db.outboxRemove(o.opId);
    } else if (failed.has(o.opId)) {
      const f = failed.get(o.opId)!;
      const attempts = (o.attempts ?? 0) + 1;
      await db.outboxPut({
        ...o,
        attempts,
        error: f.error,
        permanent: f.permanent,
        // Permanent (validation) failures stop auto-retrying until repaired.
        nextRetryAt: f.permanent ? Number.MAX_SAFE_INTEGER : Date.now() + backoffMs(attempts),
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
    const errors = [...failed.entries()].map(([opId, f]) => ({ kind: kindOf.get(opId) ?? "unknown", error: f.error }));
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
    const errors = [...failed.entries()].map(([opId, f]) => ({ kind: kindOf.get(opId) ?? "unknown", error: f.error }));
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
  // A completed sync proves the device + driver live: refresh the offline
  // unlock so an active phone never ages into a password prompt or a
  // login bounce while it keeps syncing.
  try {
    markOfflineUnlocked();
  } catch {
    /* best-effort */
  }
  // Clock-skew tripwire: the server stamps occurredAt from the PHONE clock.
  // A wrong phone clock silently misdates every offline sale (the engine
  // clamps ±5min future / 90d past). Past 10 minutes, flag it — SyncModal
  // shows the warning until the clock is fixed and a sync succeeds.
  try {
    const st = (data as { serverTime?: unknown }).serverTime;
    const srv = typeof st === "string" ? new Date(st).getTime() : NaN;
    if (Number.isFinite(srv)) {
      const skewMin = Math.round((Date.now() - srv) / 60000);
      if (Math.abs(skewMin) > 10) {
        await db.kvSet(SKEW_KEY, JSON.stringify({ skewMin, ts: Date.now() }));
      } else {
        await db.kvDel(SKEW_KEY).catch(() => {});
      }
    }
  } catch {
    /* never fail a good sync on a warning */
  }
  // A sync proves we are online: refill the static cache with the lazy
  // chunks the journée needs offline (QR decode, ticket print/share) —
  // an SW-version purge may have wiped them since the last visit.
  warmOfflineChunks();
  // Update channel: did the server move to a newer web build since we last
  // saw it? First sighting records silently; afterwards the UI prompts once
  // and the user validates → restart, update, reopen (no APK reinstall).
  const webUpdate = await detectWebUpdate(data.pulled);
  const remaining = (await getOutbox()).length;
  onProgress?.({ phase: "done", applied: okIds.size, failed: failed.size, remaining });
  return { ...data, webUpdate };
}

/// Compare the pulled web build against the last one this install ran.
/// Pure apart from storage + installed-shell lookup.
export async function detectWebUpdate(pulled: unknown): Promise<WebUpdateInfo | null> {
  try {
    const web = (pulled as { web?: { buildId?: string; minNative?: number; force?: boolean } } | null | undefined)?.web;
    const serverBuild = web?.buildId || "";
    if (!serverBuild) return null;
    const { storedBuild, rememberBuild, shouldPromptWebUpdate } = await import("./web-update");
    const known = storedBuild();
    if (!known) {
      rememberBuild(serverBuild);
      return null;
    }
    if (!shouldPromptWebUpdate(known, serverBuild)) return null;
    let mine: number | null = null;
    try {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      const n = Number(info.build);
      mine = Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      mine = null;
    }
    const minNative = Number(web?.minNative ?? 0);
    return {
      available: true,
      buildId: serverBuild,
      force: !!web?.force,
      nativeRequired: mine != null && minNative > 0 && mine < minNative,
      minNative,
    };
  } catch {
    return null;
  }
}
