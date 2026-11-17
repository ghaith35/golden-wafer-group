"use client";

import { useEffect, useState } from "react";
import { getOutbox } from "@/lib/sync/client";

export type DayStamp = { startedAt: string | null; finishedAt: string | null } | null;
/// idle = tour not started · active = started, not ended · ended = finished.
export type JourneeState = "idle" | "active" | "ended";

export function journeeState(stamp: DayStamp, pendingStart: boolean, pendingFinish: boolean): JourneeState {
  const started = Boolean(stamp?.startedAt) || pendingStart;
  const finished = Boolean(stamp?.finishedAt) || pendingFinish;
  if (started && finished) return "ended";
  if (started) return "active";
  return "idle";
}

/// Server stamp + the phone's queued (offline) départ/fin ops, so a tour
/// started or ended with no connection counts immediately.
export function useJourneeState(stamp: DayStamp): JourneeState {
  const [pend, setPend] = useState({ start: false, finish: false });
  useEffect(() => {
    let dead = false;
    const read = () =>
      getOutbox()
        .then((rows) => {
          if (dead) return;
          setPend({
            start: rows.some((r) => r.kind === "day-start"),
            finish: rows.some((r) => r.kind === "day-finish"),
          });
        })
        .catch(() => {});
    void read();
    const id = window.setInterval(read, 4000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);
  return journeeState(stamp, pend.start, pend.finish);
}
