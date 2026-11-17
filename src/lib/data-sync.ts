"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/// App-wide "data changed → everything on screen refreshes" plumbing.
///
/// Three layers (see DataSyncBoot):
///  1. A successful write (POST/PUT/PATCH/DELETE to our own /api) calls
///     `notifyDataChanged()`.
///  2. DataSyncBoot answers it with `router.refresh()` (server components
///     re-run with fresh rows) …
///  3. … and bumps the data version, which client-fetched lists subscribe to
///     with `useDataVersion()` (add it to the effect deps that load the list).
/// `useSyncedState(prop)` is `useState(prop)` that also adopts the fresh
/// server prop after a refresh — the fix for "I saved it but the list only
/// shows it after I leave the page and come back".

let version = 0;
const listeners = new Set<() => void>();
const requestListeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/// Counter that increments whenever data changed anywhere. Put it in the deps
/// of an effect that fetches a list so the list reloads by itself.
export function useDataVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

/// Mark all on-screen data stale (call after any write that bypassed fetch,
/// e.g. an offline outbox flush).
export function notifyDataChanged(): void {
  version += 1;
  listeners.forEach((l) => l());
  requestListeners.forEach((l) => l());
}

/// Internal: DataSyncBoot registers the router refresh here.
export function onRefreshRequested(cb: () => void): () => void {
  requestListeners.add(cb);
  return () => requestListeners.delete(cb);
}

/// `useState(prop)` that follows the prop when the server hands a new one
/// (after `router.refresh()`), while still allowing local optimistic edits
/// in between. Only use for collections that come straight from a server
/// page — never for a form draft (it would wipe what the user is typing).
export function useSyncedState<T>(prop: T) {
  const [state, setState] = useState<T>(prop);
  const [seen, setSeen] = useState<T>(prop);
  if (!Object.is(prop, seen)) {
    setSeen(prop);
    setState(prop);
  }
  return [state, setState] as const;
}

/// True while a refresh is in flight (drives the top-bar spinner).
let pending = false;
const pendingListeners = new Set<() => void>();
export function setRefreshPending(v: boolean) {
  if (pending === v) return;
  pending = v;
  pendingListeners.forEach((l) => l());
}
export function useRefreshPending(): boolean {
  const [p, setP] = useState(pending);
  useEffect(() => {
    const l = () => setP(pending);
    pendingListeners.add(l);
    l();
    return () => {
      pendingListeners.delete(l);
    };
  }, []);
  return p;
}
