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
          nextRetryAt INTEGER NOT NULL DEFAULT 0
        );
      `);
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
  const res = await db.query("SELECT opId, kind, payload, ts, error, attempts, nextRetryAt FROM outbox ORDER BY ts ASC;");
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
      "INSERT OR REPLACE INTO outbox (opId, kind, payload, ts, error, attempts, nextRetryAt) VALUES (?, ?, ?, ?, ?, ?, ?);",
      [row.opId, row.kind, JSON.stringify(row.payload), row.ts, row.error ?? null, row.attempts, row.nextRetryAt]
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
  return isNative() ? nativeDriver : webDriver;
}

export const db = {
  kvGet: (key: string) => driver().kvGet(key),
  kvSet: (key: string, value: string) => driver().kvSet(key, value),
  kvDel: (key: string) => driver().kvDel(key),
  outboxList: () => driver().outboxList(),
  outboxPut: (row: OutboxRow) => driver().outboxPut(row),
  outboxRemove: (opId: string) => driver().outboxRemove(opId),
  /** Pre-warm the native database (creates file + tables). No-op on web. */
  async ready(): Promise<void> {
    if (typeof window === "undefined" || !isNative()) return;
    await getNativeDb();
  },
};
