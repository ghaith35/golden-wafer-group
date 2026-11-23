/// A van can run up to two tours on the same day. These PURE helpers decide
/// which one is "the current tour" wherever the app used to assume a single
/// tour per van per day (stamps, sales, clients list, dashboard…).

type DayTour = {
  status?: string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  slot?: number | null;
  createdAt?: Date | string | null;
};

const t = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : 0);

/// Stable day order: slot (0, 1), then creation time.
export function sortDayTours<T extends DayTour>(tours: T[]): T[] {
  return [...tours].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0) || t(a.createdAt) - t(b.createdAt));
}

const running = (x: DayTour) => x.status !== "CLOSED" && !!x.startedAt && !x.finishedAt;
const waiting = (x: DayTour) => x.status !== "CLOSED" && !x.startedAt && !x.finishedAt;

/// The tour the driver is on: the one in progress; else the next one still
/// waiting to start; else (all done) the last one.
export function pickCurrentTour<T extends DayTour>(tours: T[]): T | null {
  if (!tours.length) return null;
  const ordered = sortDayTours(tours);
  return ordered.find(running) ?? ordered.find(waiting) ?? ordered[ordered.length - 1];
}

/// Every tour of the day has been driven to the end (and there is at least one).
export function dayFinished<T extends DayTour>(tours: T[]): boolean {
  return tours.length > 0 && tours.every((x) => !!x.finishedAt || x.status === "CLOSED");
}
