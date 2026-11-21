"use client";

import { useEffect, useState } from "react";
import { getOutbox } from "@/lib/sync/client";
import { algiersDayKey } from "@/lib/tournees/days";

export type DayStamp = { startedAt: string | null; finishedAt: string | null } | null;
/// idle = tour not started · active = started, not ended · ended = finished.
export type JourneeState = "idle" | "active" | "ended";

/// A journée lasts only through its own calendar day (Algiers): started
/// Sunday at 10:00 it ends with Sunday, even if the driver never closed it.
/// `daySlug` is the URL day `yyyy-m-d`; once that day is past, an open
/// journée counts as ended (the server stamps it 23:59:59 + flags it).
export function isPastDaySlug(daySlug: string | undefined, now = new Date()): boolean {
  const m = daySlug ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(daySlug) : null;
  if (!m) return false;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` < algiersDayKey(now);
}

export function journeeState(stamp: DayStamp, pendingStart: boolean, pendingFinish: boolean, dayPast = false): JourneeState {
  const started = Boolean(stamp?.startedAt) || pendingStart;
  const finished = Boolean(stamp?.finishedAt) || pendingFinish || (started && dayPast);
  if (started && finished) return "ended";
  if (started) return "active";
  return "idle";
}

/// Server stamp + the phone's queued (offline) départ/fin ops, so a tour
/// started or ended with no connection counts immediately.
export function useJourneeState(stamp: DayStamp, daySlug?: string): JourneeState {
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
  return journeeState(stamp, pend.start, pend.finish, isPastDaySlug(daySlug));
}
