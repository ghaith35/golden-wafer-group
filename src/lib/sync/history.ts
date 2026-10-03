import { db } from "./offline-db";

/// Phone-side sync journal: every attempt recorded (success or failure) —
/// the user sees what each sync did, exactly. Bounded to the last 50.

const HIST_KEY = "dili_sync_history_v1";
const MAX_ENTRIES = 50;

export type SyncHistoryEntry = {
  ts: number;
  ok: boolean;
  /// ms the attempt took (0 when it never reached the server).
  ms: number;
  uploaded: number;
  applied: number;
  failed: number;
  /// Applied per op kind, e.g. { ticket: 3, order: 1 }.
  kinds: Record<string, number>;
  /// Failed ops with their server error.
  errors: Array<{ kind: string; error: string }>;
  products: number;
  clients: number;
  images: number;
  /// Top-level failure (offline, no token, server error…).
  error?: string;
};

export async function loadHistory(): Promise<SyncHistoryEntry[]> {
  try {
    const raw = await db.kvGet(HIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SyncHistoryEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function appendHistory(entry: SyncHistoryEntry): Promise<void> {
  try {
    const prev = await loadHistory();
    const next = [entry, ...prev].slice(0, MAX_ENTRIES);
    await db.kvSet(HIST_KEY, JSON.stringify(next));
  } catch {
    /* history must never break the sync */
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await db.kvSet(HIST_KEY, JSON.stringify([]));
  } catch {
    /* ignore */
  }
}
