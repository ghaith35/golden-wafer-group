import { describe, it, expect } from "vitest";
import { pickCurrentTour, dayFinished, sortDayTours } from "@/lib/tournees/day-tours";

const A = { id: "A", slot: 0, status: "OPEN", startedAt: null, finishedAt: null };
const B = { id: "B", slot: 1, status: "OPEN", startedAt: null, finishedAt: null };

describe("current tour of a day with two tours", () => {
  it("nothing started: the first slot waits", () => {
    expect(pickCurrentTour([B, A])?.id).toBe("A");
  });
  it("the one in progress wins, even if it is the second", () => {
    expect(pickCurrentTour([A, { ...B, startedAt: "2026-11-24T08:00:00Z" }])?.id).toBe("B");
  });
  it("after the first is finished the second becomes current", () => {
    expect(pickCurrentTour([{ ...A, startedAt: "x", finishedAt: "y" }, B])?.id).toBe("B");
  });
  it("all finished: the last one, and the day is finished", () => {
    const done = [{ ...A, startedAt: "x", finishedAt: "y" }, { ...B, startedAt: "x", finishedAt: "z" }];
    expect(pickCurrentTour(done)?.id).toBe("B");
    expect(dayFinished(done)).toBe(true);
  });
  it("a day with one running and one waiting is not finished", () => {
    expect(dayFinished([{ ...A, startedAt: "x", finishedAt: "y" }, B])).toBe(false);
  });
  it("no tours", () => {
    expect(pickCurrentTour([])).toBeNull();
    expect(dayFinished([])).toBe(false);
  });
  it("sorts by slot then creation", () => {
    expect(sortDayTours([B, A]).map((x) => x.id)).toEqual(["A", "B"]);
  });
});
