"use client";

/// On-device database for the van phone: the APK's own SQLite database.
///
/// - Native (APK): real SQLite file `distribuili-van.db` via
///   @capacitor-community/sqlite — survives app restarts, no 5MB WebView quota.
/// - Web (PWA/browser): localStorage driver using the exact legacy key formats,
///   so existing installs migrate seamlessly with zero data loss.
///
/// Tables/state: `kv` (snapshot, tokens, metadata) + `outbox` (queued ops with
/// retry bookkeeping). All access is async through this module.

import { Capacitor } from "@capacitor/core";

export type OutboxRow = {
  opId: string;
  kind: string;
  payload: Record<string, unknown>;
  ts: number;
  error?: string;
  attempts: number;
  nextRetryAt: number;
  /// Server the op belongs to (origin at queue time). Never upload an op to
  /// a different server — one phone, one client, no cross-client leakage.
  server?: string | null;
  /// Server rejected it permanently (validation) — stop auto-retrying until
  /// the user repairs or discards it.
  permanent?: boolean;
};

export const LEGACY_OUTBOX_KEY = "dili_outbox_v1";

interface Driver {
  kvGet(key: string): Promise<string | null>;
  kvSet(key: string, value: string): Promise<void>;
  kvDel(key: string): Promise<void>;
  outboxList(): Promise<OutboxRow[]>;
  outboxPut(row: OutboxRow): Promise<void>;
  outboxRemove(opId: string): Promise<void>;
}

function normalizeRow(raw: Record<string, unknown>): OutboxRow | null {
  if (typeof raw.opId !== "string" || typeof raw.kind !== "string") return null;
  return {
    opId: raw.opId,
    kind: raw.kind,
    payload: (raw.payload ?? {}) as Record<string, unknown>,
    ts: typeof raw.ts === "number" ? raw.ts : Date.now(),
    error: typeof raw.error === "string" ? raw.error : undefined,
    attempts: typeof raw.attempts === "number" ? raw.attempts : 0,
    nextRetryAt: typeof raw.nextRetryAt === "number" ? raw.nextRetryAt : 0,
    server: typeof raw.server === "string" && raw.server ? raw.server : null,
    permanent: raw.permanent === true,
  };
}

// ─── Web driver (localStorage, legacy-compatible) ────────────────────────────

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage full — oldest ops stay, sync ASAP */
  }
}

const webDriver: Driver = {
  async kvGet(key) {
    return lsGet(key);
  },
  async kvSet(key, value) {
    lsSet(key, value);
  },
  async kvDel(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  async outboxList() {
    try {
      const raw = localStorage.getItem(LEGACY_OUTBOX_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr
        .map((r) => normalizeRow(r as Record<string, unknown>))
        .filter((r): r is OutboxRow => r !== null);
    } catch {
      return [];
    }
  },
  async outboxPut(row) {
    const rows = await webDriver.outboxList();
    const i = rows.findIndex((r) => r.opId === row.opId);
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    lsSet(LEGACY_OUTBOX_KEY, JSON.stringify(rows));
  },
  async outboxRemove(opId) {
    const rows = await webDriver.outboxList();
    lsSet(LEGACY_OUTBOX_KEY, JSON.stringify(rows.filter((r) => r.opId !== opId)));
  },
};

// ─── Native driver (real SQLite file) ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativeDB = { query: (s: string, v?: unknown[]) => Promise<{ values?: any[] }>; run: (s: string, v?: unknown[]) => Promise<unknown>; execute: (s: string) => Promise<unknown>; open: () => Promise<void>; close?: () => Promise<void> };

let nativeDb: NativeDB | null = null;
let nativeReady: Promise<NativeDB> | null = null;

async function getNativeDb(): Promise<NativeDB> {
  if (nativeDb) return nativeDb;
  if (!nativeReady) {
    nativeReady = (async () => {
      const { SQLiteConnection, CapacitorSQLite } = await import("@capacitor-community/sqlite");
      const sqlite = new SQLiteConnection(CapacitorSQLite);
      const db = (await sqlite.createConnection(
        "distribuili-van",
        false,
        "no-encryption",
        1,
        false
      )) as unknown as NativeDB;
      await db.open();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox (
          opId TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          ts INTEGER NOT NULL,
          error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          nextRetryAt INTEGER NOT NULL DEFAULT 0,
          permanent INTEGER NOT NULL DEFAULT 0,
          server TEXT
        );
      `);
      // Upgrade older installs that lack the newer columns.
      await db.execute("ALTER TABLE outbox ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0;").catch(() => undefined);
      await db.execute("ALTER TABLE outbox ADD COLUMN server TEXT;").catch(() => undefined);
      nativeDb = db;
      return db;
    })().catch((e) => {
      nativeReady = null;
      throw e;
    });
  }
  return nativeReady;
}

async function nativeRows(): Promise<OutboxRow[]> {
  const db = await getNativeDb();
  const res = await db.query("SELECT opId, kind, payload, ts, error, attempts, nextRetryAt, permanent, server FROM outbox ORDER BY ts ASC;");
  const out: OutboxRow[] = [];
  for (const r of res.values ?? []) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(r.payload as string) as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
    const row = normalizeRow({
      opId: r.opId,
      kind: r.kind,
      payload,
      ts: Number(r.ts),
      error: r.error ?? undefined,
      attempts: Number(r.attempts ?? 0),
      nextRetryAt: Number(r.nextRetryAt ?? 0),
      permanent: Number(r.permanent ?? 0) === 1,
      server: typeof r.server === "string" && r.server ? (r.server as string) : null,
    });
    if (row) out.push(row);
  }
  return out;
}

const nativeDriver: Driver = {
  async kvGet(key) {
    const db = await getNativeDb();
    const res = await db.query("SELECT value FROM kv WHERE key = ?;", [key]);
    const v = res.values?.[0]?.value;
    return typeof v === "string" ? v : null;
  },
  async kvSet(key, value) {
    const db = await getNativeDb();
    await db.run("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?);", [key, value]);
  },
  async kvDel(key) {
    const db = await getNativeDb();
    await db.run("DELETE FROM kv WHERE key = ?;", [key]);
  },
  async outboxList() {
    return nativeRows();
  },
  async outboxPut(row) {
    const db = await getNativeDb();
    await db.run(
      "INSERT OR REPLACE INTO outbox (opId, kind, payload, ts, error, attempts, nextRetryAt, permanent, server) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
      [row.opId, row.kind, JSON.stringify(row.payload), row.ts, row.error ?? null, row.attempts, row.nextRetryAt, row.permanent ? 1 : 0, row.server ?? null]
    );
  },
  async outboxRemove(opId) {
    const db = await getNativeDb();
    await db.run("DELETE FROM outbox WHERE opId = ?;", [opId]);
  },
};

// ─── Public entry ────────────────────────────────────────────────────────────

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function driver(): Driver {
  if (typeof window === "undefined") return webDriver;
  if (nativeBroken) return webDriver;
  return isNative() ? nativeDriver : webDriver;
}

/// Once the native plugin fails (missing/broken SQLite on the device),
/// stick to localStorage for the rest of the session: a sale must NEVER be
/// lost because the native database hiccups. Reads merge both stores so ops
/// written before the break are still found.
let nativeBroken = false;

function markNativeBroken(e: unknown): void {
  if (!nativeBroken) {
    nativeBroken = true;
    try {
      console.warn("[outbox] native SQLite failed, falling back to localStorage:", e);
    } catch { /* logging unavailable */ }
  }
}

async function mergedOutboxList(): Promise<OutboxRow[]> {
  const [a, b] = await Promise.all([
    webDriver.outboxList().catch((): OutboxRow[] => []),
    (isNative() && typeof window !== "undefined"
      ? nativeDriver.outboxList().catch((): OutboxRow[] => [])
      : Promise.resolve([] as OutboxRow[])),
  ]);
  const seen = new Map<string, OutboxRow>();
  for (const r of [...a, ...b]) {
    const prev = seen.get(r.opId);
    if (!prev || (r.ts ?? 0) >= (prev.ts ?? 0)) seen.set(r.opId, r);
  }
  return [...seen.values()].sort((x, y) => (x.ts ?? 0) - (y.ts ?? 0));
}

export const db = {
  kvGet: async (key: string) => {
    try {
      return await driver().kvGet(key);
    } catch (e) {
      if (isNative() && typeof window !== "undefined" && !nativeBroken) {
        markNativeBroken(e);
        return webDriver.kvGet(key);
      }
      throw e;
    }
  },
  kvSet: async (key: string, value: string) => {
    try {
      return await driver().kvSet(key, value);
    } catch (e) {
      if (isNative() && typeof window !== "undefined" && !nativeBroken) {
        markNativeBroken(e);
        return webDriver.kvSet(key, value);
      }
      throw e;
    }
  },
  kvDel: async (key: string) => {
    try {
      return await driver().kvDel(key);
    } catch (e) {
      if (isNative() && typeof window !== "undefined" && !nativeBroken) {
        markNativeBroken(e);
        return webDriver.kvDel(key);
      }
      throw e;
    }
  },
  outboxList: () => mergedOutboxList(),
  outboxPut: async (row: OutboxRow) => {
    try {
      return await driver().outboxPut(row);
    } catch (e) {
      if (isNative() && typeof window !== "undefined" && !nativeBroken) {
        markNativeBroken(e);
        return webDriver.outboxPut(row);
      }
      throw e;
    }
  },
  outboxRemove: async (opId: string) => {
    // Remove from both stores: the op may live in either after a fallback.
    const res = await Promise.allSettled([webDriver.outboxRemove(opId), ...(isNative() && typeof window !== "undefined" ? [nativeDriver.outboxRemove(opId).catch(() => undefined)] : [])]);
    if (res[0].status === "rejected" && (!isNative() || nativeBroken)) throw (res[0] as PromiseRejectedResult).reason;
  },
  /** Pre-warm the native database (creates file + tables). No-op on web. */
  async ready(): Promise<void> {
    if (typeof window === "undefined" || !isNative()) return;
    try {
      await getNativeDb();
    } catch (e) {
      // Don't poison the session here: the per-call fallback still saves
      // every op to localStorage if SQLite is broken on this device.
      try {
        console.warn("[outbox] native pre-warm failed, will fall back per-call:", e);
      } catch { /* logging unavailable */ }
    }
  },
};
