import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// REAL end-to-end on SQLite (same engine as the offline desktop app): the
// actual plan service creates weekly / every-2-weeks tours, generates days on
// demand with no end date, and a day can hold two tours. No mocks.

const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), "distribuili-plans-e2e-"));
const dbFile = join(root, "e2e.db");

type Plans = typeof import("@/lib/tournees/plans");
type Days = typeof import("@/lib/tournees/days");
type Pure = typeof import("@/lib/tournees/plans-pure");
type Db = typeof import("@/lib/db");
let P: Plans, D: Days, U: Pure, prisma: Db["prisma"];
const ids = { co: "", van: "", van2: "", secA: "", secB: "", secC: "" };
const clientsA: string[] = [];

/// First Monday strictly after today (Algiers calendar).
function nextMonday(): string {
  let k = D.addDaysKey(D.algiersDayKey(new Date()), 1);
  while (U.weekdayOfKey(k) !== 1) k = D.addDaysKey(k, 1);
  return k;
}
const toursOn = (vanId: string, key: string) =>
  prisma.tournee.findMany({ where: { locationId: vanId, date: D.algiersDayRange(new Date(`${key}T12:00:00Z`)) }, orderBy: { slot: "asc" }, include: { stops: true } });

beforeAll(async () => {
  const Database = require("libsql");
  const d = new Database(dbFile);
  d.exec(readFileSync(resolve(__dirname, "../../prisma/sqlite-init.sql"), "utf8"));
  d.close();
  process.env.DISTRIBUILI_DB = "local";
  process.env.DISTRIBUILI_SQLITE_URL = `file:${dbFile}`;
  process.env.DISTRIBUILI_SQLITE_CLIENT = resolve(__dirname, "../../src/generated/prisma-sqlite");
  prisma = (await import("@/lib/db")).prisma;
  P = await import("@/lib/tournees/plans");
  D = await import("@/lib/tournees/days");
  U = await import("@/lib/tournees/plans-pure");

  await prisma.wilaya.create({ data: { code: 16, nameAr: "الجزائر", nameFr: "Alger" } });
  const co = await prisma.company.create({ data: { name: "Plans Co" } });
  ids.co = co.id;
  // Already migrated: the legacy conversion has its own test below.
  await prisma.companySettings.create({ data: { companyId: co.id, tourPlansMigratedAt: new Date() } });
  ids.van = (await prisma.store.create({ data: { companyId: co.id, name: "Van 1", kind: "VAN" } })).id;
  ids.van2 = (await prisma.store.create({ data: { companyId: co.id, name: "Van 2", kind: "VAN" } })).id;
  ids.secA = (await prisma.secteur.create({ data: { companyId: co.id, name: "Sector A", wilayaCode: 16 } })).id;
  ids.secB = (await prisma.secteur.create({ data: { companyId: co.id, name: "Sector B", wilayaCode: 16 } })).id;
  ids.secC = (await prisma.secteur.create({ data: { companyId: co.id, name: "Sector C", wilayaCode: 16 } })).id;
  for (let i = 1; i <= 3; i++) clientsA.push((await prisma.customer.create({ data: { companyId: co.id, code: `A-${i}`, name: `A client ${i}`, secteurId: ids.secA } })).id);
  for (let i = 1; i <= 2; i++) await prisma.customer.create({ data: { companyId: co.id, code: `B-${i}`, name: `B client ${i}`, secteurId: ids.secB } });
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(root, { recursive: true, force: true });
});

describe("recurring tours on a real database", () => {
  let monday = "";
  let weeklyId = "";
  let biweeklyId = "";

  it("a weekly plan generates its sector's clients on the clicked day and the following weeks", async () => {
    monday = nextMonday();
    const plan = await P.createPlan(ids.co, { locationId: ids.van, secteurId: ids.secA, dateKey: monday, intervalWeeks: 1 });
    weeklyId = plan.id;
    const t = await toursOn(ids.van, monday);
    expect(t).toHaveLength(1);
    expect(t[0].stops).toHaveLength(3);
    expect(t[0].planId).toBe(plan.id);
    expect((await toursOn(ids.van, D.addDaysKey(monday, 7))).length).toBe(1);
    expect((await toursOn(ids.van, D.addDaysKey(monday, 14))).length).toBe(1);
  });

  it("is endless: asking for a day years ahead generates it", async () => {
    const far = D.addDaysKey(monday, 7 * 156); // 3 years
    expect(await toursOn(ids.van, far)).toHaveLength(0);
    await P.ensureDayTours(ids.co, ids.van, far);
    const t = await toursOn(ids.van, far);
    expect(t).toHaveLength(1);
    expect(t[0].stops).toHaveLength(3);
  });

  it("a second plan every 2 weeks in the SAME cell gives that Monday two tours", async () => {
    const plan = await P.createPlan(ids.co, { locationId: ids.van, secteurId: ids.secB, dateKey: monday, intervalWeeks: 2 });
    biweeklyId = plan.id;
    const week1 = await toursOn(ids.van, monday);
    expect(week1.map((t) => t.slot)).toEqual([0, 1]);
    expect(week1.map((t) => t.secteurId)).toEqual([ids.secA, ids.secB]);
    // week 2: only the weekly one; week 3: both again
    await P.materializePlans(ids.co, { fromKey: monday, toKey: D.addDaysKey(monday, 21) });
    expect(await toursOn(ids.van, D.addDaysKey(monday, 7))).toHaveLength(1);
    expect(await toursOn(ids.van, D.addDaysKey(monday, 14))).toHaveLength(2);
    expect(await toursOn(ids.van, D.addDaysKey(monday, 21))).toHaveLength(1);
  });

  it("a cell holds at most two plans", async () => {
    await expect(P.createPlan(ids.co, { locationId: ids.van, secteurId: ids.secC, dateKey: monday, intervalWeeks: 1 })).rejects.toThrow("cell_full");
    // another weekday / another van is unaffected
    await expect(P.createPlan(ids.co, { locationId: ids.van, secteurId: ids.secC, dateKey: D.addDaysKey(monday, 1), intervalWeeks: 1 })).resolves.toBeTruthy();
    await expect(P.createPlan(ids.co, { locationId: ids.van2, secteurId: ids.secC, dateKey: monday, intervalWeeks: 1 })).resolves.toBeTruthy();
  });

  it("generating again never duplicates a day", async () => {
    const before = await prisma.tournee.count({ where: { companyId: ids.co } });
    await P.materializePlans(ids.co, { fromKey: monday, toKey: D.addDaysKey(monday, 60) });
    await P.materializePlans(ids.co, { fromKey: monday, toKey: D.addDaysKey(monday, 60) });
    const after = await prisma.tournee.count({ where: { companyId: ids.co } });
    // only days beyond the previous horizon may be new; re-running adds none
    await P.materializePlans(ids.co, { fromKey: monday, toKey: D.addDaysKey(monday, 60) });
    expect(await prisma.tournee.count({ where: { companyId: ids.co } })).toBe(after);
    expect(after).toBeGreaterThanOrEqual(before);
    const dupes = await prisma.tournee.groupBy({ by: ["planId", "date"], where: { companyId: ids.co, planId: { not: null } }, _count: true, having: { planId: { _count: { gt: 1 } } } });
    expect(dupes).toHaveLength(0);
  });

  it("a client added to the sector later joins the days that have not started", async () => {
    const c = await prisma.customer.create({ data: { companyId: ids.co, code: "A-4", name: "A client 4", secteurId: ids.secA } });
    await P.materializePlans(ids.co, { fromKey: monday, toKey: D.addDaysKey(monday, 14) });
    const t = (await toursOn(ids.van, D.addDaysKey(monday, 7)))[0];
    expect(t.stops.map((s) => s.clientId)).toContain(c.id);
    expect(t.stops).toHaveLength(4);
  });

  it("removing ONE day keeps the plan running and never regenerates that date", async () => {
    const target = (await toursOn(ids.van, D.addDaysKey(monday, 7)))[0];
    await P.skipOccurrence(ids.co, target.id);
    expect(await toursOn(ids.van, D.addDaysKey(monday, 7))).toHaveLength(0);
    await P.materializePlans(ids.co, { fromKey: monday, toKey: D.addDaysKey(monday, 28) });
    expect(await toursOn(ids.van, D.addDaysKey(monday, 7))).toHaveLength(0); // stays removed
    expect(await toursOn(ids.van, D.addDaysKey(monday, 14))).toHaveLength(2); // plan continues
  });

  it("editing the clients of one day makes every later day follow", async () => {
    const day2 = (await toursOn(ids.van, D.addDaysKey(monday, 14)))[0];
    await P.updatePlanStops(ids.co, weeklyId, [clientsA[2], clientsA[0]]);
    const later = (await toursOn(ids.van, D.addDaysKey(monday, 21)))[0];
    expect(later.stops.sort((a, b) => a.position - b.position).map((s) => s.clientId)).toEqual([clientsA[2], clientsA[0]]);
    expect(day2.planId).toBe(weeklyId);
    // days created later follow the hand-picked list too
    await P.ensureDayTours(ids.co, ids.van, D.addDaysKey(monday, 7 * 80));
    const far = (await toursOn(ids.van, D.addDaysKey(monday, 7 * 80)))[0];
    expect(far.stops).toHaveLength(2);
  });

  it("a started day is never touched by edits or deletion", async () => {
    const day = (await toursOn(ids.van, monday))[0];
    const before = day.stops.map((s) => s.clientId).sort();
    await prisma.tournee.update({ where: { id: day.id }, data: { startedAt: new Date() } });
    await P.updatePlanStops(ids.co, weeklyId, [clientsA[1]]);
    expect((await toursOn(ids.van, monday))[0].stops.map((s) => s.clientId).sort()).toEqual(before); // started: unchanged
    // ...while a later, not-started day did follow
    expect((await toursOn(ids.van, D.addDaysKey(monday, 21)))[0].stops.map((s) => s.clientId)).toEqual([clientsA[1]]);
  });

  it("ending a plan removes its future days and stops generating", async () => {
    await P.deletePlan(ids.co, biweeklyId);
    expect((await prisma.tourneePlan.findUnique({ where: { id: biweeklyId } }))?.isActive).toBe(false);
    const future = await prisma.tournee.count({ where: { planId: biweeklyId, startedAt: null } });
    expect(future).toBe(0);
    await P.materializePlans(ids.co, { fromKey: monday, toKey: D.addDaysKey(monday, 60) });
    expect(await prisma.tournee.count({ where: { planId: biweeklyId, startedAt: null } })).toBe(0);
    // the cell has a free slot again
    await expect(P.createPlan(ids.co, { locationId: ids.van, secteurId: ids.secB, dateKey: D.addDaysKey(monday, 7), intervalWeeks: 2 })).resolves.toBeTruthy();
  });
});

describe("legacy 12-week copies become endless weekly plans", () => {
  it("converts once, links the tours, and keeps going past the old 12 weeks", async () => {
    const co = await prisma.company.create({ data: { name: "Legacy Co" } });
    await prisma.companySettings.create({ data: { companyId: co.id } }); // marker still null
    const van = await prisma.store.create({ data: { companyId: co.id, name: "Old van", kind: "VAN" } });
    const sec = await prisma.secteur.create({ data: { companyId: co.id, name: "Old sector", wilayaCode: 16 } });
    const cl = await prisma.customer.create({ data: { companyId: co.id, code: "L-1", name: "L1", secteurId: sec.id } });
    const first = nextMonday();
    for (let w = 0; w < 12; w++) {
      const t = await prisma.tournee.create({ data: { companyId: co.id, locationId: van.id, secteurId: sec.id, date: new Date(`${D.addDaysKey(first, 7 * w)}T00:00:00Z`) } });
      await prisma.tourneeStop.create({ data: { tourneeId: t.id, clientId: cl.id, position: 0 } });
    }
    // an ad-hoc driver tour (not a series) on another day also exists, plan-less, in the past: untouched
    await P.materializePlans(co.id, { fromKey: first, toKey: first });
    expect(await prisma.tourneePlan.count({ where: { companyId: co.id } })).toBe(1);
    const plan = await prisma.tourneePlan.findFirstOrThrow({ where: { companyId: co.id } });
    expect(plan.intervalWeeks).toBe(1);
    expect(plan.weekday).toBe(1);
    expect(await prisma.tournee.count({ where: { companyId: co.id, planId: plan.id } })).toBe(12);
    // running it again converts nothing new
    await P.materializePlans(co.id, { fromKey: first, toKey: first });
    expect(await prisma.tourneePlan.count({ where: { companyId: co.id } })).toBe(1);
    // week 13, 30 and 200 exist once asked for
    for (const w of [12, 30, 200]) {
      await P.ensureDayTours(co.id, van.id, D.addDaysKey(first, 7 * w));
      const t = await prisma.tournee.findMany({ where: { locationId: van.id, date: D.algiersDayRange(new Date(`${D.addDaysKey(first, 7 * w)}T12:00:00Z`)) } });
      expect(t).toHaveLength(1);
    }
  });
});

describe("two tours on one day run one after the other", () => {
  it("the second cannot start until the first is finished; both then count as done", async () => {
    const svc = await import("@/lib/tournees/service");
    const { pickCurrentTour, dayFinished } = await import("@/lib/tournees/day-tours");
    const co = await prisma.company.create({ data: { name: "Two tours Co" } });
    await prisma.companySettings.create({ data: { companyId: co.id, tourPlansMigratedAt: new Date() } });
    const user = await prisma.user.create({ data: { companyId: co.id, username: "driver1", passwordHash: "x", fullName: "Driver", role: "Livreur" } });
    const van = await prisma.store.create({ data: { companyId: co.id, name: "Van D", kind: "VAN", userId: user.id } });
    const s1 = await prisma.secteur.create({ data: { companyId: co.id, name: "S1", wilayaCode: 16 } });
    const s2 = await prisma.secteur.create({ data: { companyId: co.id, name: "S2", wilayaCode: 16 } });
    await prisma.customer.create({ data: { companyId: co.id, code: "D-1", name: "D1", secteurId: s1.id } });
    await prisma.customer.create({ data: { companyId: co.id, code: "D-2", name: "D2", secteurId: s2.id } });
    const monday = nextMonday();
    await P.createPlan(co.id, { locationId: van.id, secteurId: s1.id, dateKey: monday, intervalWeeks: 1 });
    await P.createPlan(co.id, { locationId: van.id, secteurId: s2.id, dateKey: monday, intervalWeeks: 2 });
    const tours = await toursOn(van.id, monday);
    expect(tours).toHaveLength(2);
    expect(pickCurrentTour(tours)?.id).toBe(tours[0].id);

    await svc.startDay(co.id, user.id, "Livreur", tours[0].id);
    expect(pickCurrentTour(await toursOn(van.id, monday))?.id).toBe(tours[0].id); // running one is current
    await expect(svc.startDay(co.id, user.id, "Livreur", tours[1].id)).rejects.toThrow("another_tour_running");

    await svc.finishDay(co.id, user.id, "Livreur", tours[0].id);
    const mid = await toursOn(van.id, monday);
    expect(pickCurrentTour(mid)?.id).toBe(tours[1].id); // the second is now current
    expect(dayFinished(mid)).toBe(false);

    await svc.startDay(co.id, user.id, "Livreur", tours[1].id);
    await svc.finishDay(co.id, user.id, "Livreur", tours[1].id);
    expect(dayFinished(await toursOn(van.id, monday))).toBe(true);
  });

  it("a replayed offline start (with its real time) is not blocked by ordering", async () => {
    const svc = await import("@/lib/tournees/service");
    const co = await prisma.company.findFirstOrThrow({ where: { name: "Two tours Co" } });
    const user = await prisma.user.findFirstOrThrow({ where: { companyId: co.id } });
    const van = await prisma.store.findFirstOrThrow({ where: { companyId: co.id, kind: "VAN" } });
    const later = D.addDaysKey(nextMonday(), 14); // a day with both plans due
    await P.ensureDayTours(co.id, van.id, later);
    const t = await toursOn(van.id, later);
    expect(t.length).toBe(2);
    await svc.startDay(co.id, user.id, "Livreur", t[0].id, new Date());
    await expect(svc.startDay(co.id, user.id, "Livreur", t[1].id, new Date())).resolves.toBeTruthy();
  });
});
