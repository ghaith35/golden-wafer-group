import { prisma } from "@/lib/db";
import { addDaysKey, algiersDayKey, algiersDayRange, weekStartKey } from "./days";
import { dueKeys, isPlanDue, weekdayOfKey, withSkip, type PlanShape } from "./plans-pure";

/// Recurring tours. A TourneePlan (van + weekday + sector + every 1 or 2 weeks,
/// NO end date) generates the real daily Tournee rows on demand — whenever the
/// board, a driver's day screen or a phone sync asks for a day. Nothing is
/// pre-generated for a fixed number of weeks, so a plan never runs out.

export const MAX_PLANS_PER_CELL = 2;
/// How far ahead the board / sync keep daily tours generated (rolling, not a limit).
export const LOOKAHEAD_DAYS = 21;

const keyToDate = (key: string) => new Date(`${key}T00:00:00Z`);
const bad = (code: string, status = 400) => Object.assign(new Error(code), { status });

type PlanRow = {
  id: string; companyId: string; locationId: string; secteurId: string | null;
  weekday: number; intervalWeeks: number; anchorKey: string; slot: number;
  clientIds: string | null; skips: string; notes: string | null; isActive: boolean;
};

function parseIds(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/// Client ids a plan's tour visits, in order: the hand-picked list (still
/// active clients only) or every active client of the sector.
async function stopIdsFor(plan: PlanRow): Promise<string[]> {
  const custom = parseIds(plan.clientIds);
  if (custom) {
    if (!custom.length) return [];
    const ok = await prisma.customer.findMany({ where: { id: { in: custom }, companyId: plan.companyId, isActive: true }, select: { id: true } });
    const set = new Set(ok.map((c) => c.id));
    return custom.filter((id) => set.has(id));
  }
  if (!plan.secteurId) return [];
  const rows = await prisma.customer.findMany({
    where: { companyId: plan.companyId, secteurId: plan.secteurId, isActive: true },
    select: { id: true },
    orderBy: { name: "asc" },
    take: 1000,
  });
  return rows.map((c) => c.id);
}

function isUnique(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "P2002" || /unique constraint/i.test(err?.message ?? "");
}

/// One generated day. Returns null when it already exists (concurrent create).
async function createOccurrence(plan: PlanRow, key: string, stopIds?: string[]) {
  const ids = stopIds ?? (await stopIdsFor(plan));
  try {
    return await prisma.$transaction(async (tx) => {
      const t = await tx.tournee.create({
        data: {
          companyId: plan.companyId,
          date: keyToDate(key),
          locationId: plan.locationId,
          secteurId: plan.secteurId,
          notes: plan.notes,
          planId: plan.id,
          slot: plan.slot,
        },
      });
      if (ids.length) await tx.tourneeStop.createMany({ data: ids.map((clientId, position) => ({ tourneeId: t.id, clientId, position })) });
      return t;
    });
  } catch (e) {
    if (isUnique(e)) return null;
    throw e;
  }
}

/// Generate the daily tours every active plan owes in [fromKey, toKey]. Past
/// days are never generated (history is what was actually driven). Existing,
/// not-yet-started days of a sector plan also pick up clients added to the
/// sector since. Idempotent and safe to call from anywhere, any number of times.
export async function materializePlans(
  companyId: string,
  opts: { fromKey: string; toKey: string; vanId?: string | null },
): Promise<number> {
  await ensureLegacyConverted(companyId);
  const today = algiersDayKey(new Date());
  const fromKey = opts.fromKey < today ? today : opts.fromKey;
  if (opts.toKey < fromKey) return 0;
  const plans = await prisma.tourneePlan.findMany({
    // A plan whose sector was deleted and that has no hand-picked clients has nothing to visit.
    where: {
      companyId, isActive: true, ...(opts.vanId ? { locationId: opts.vanId } : {}),
      OR: [{ secteurId: { not: null } }, { clientIds: { not: null } }],
    },
  });
  let created = 0;
  for (const plan of plans) {
    const keys = dueKeys(plan, fromKey, opts.toKey);
    if (!keys.length) continue;
    // By calendar day (old tours may carry a time of day, not only midnight).
    const have = await prisma.tournee.findMany({
      where: { planId: plan.id, date: { gte: algiersDayRange(keyToDate(keys[0])).gte, lt: algiersDayRange(keyToDate(keys[keys.length - 1])).lt } },
      select: { id: true, date: true, status: true, startedAt: true, stops: { select: { clientId: true } } },
    });
    const haveKeys = new Set(have.map((h) => algiersDayKey(h.date)));
    let ids: string[] | null = null;
    for (const key of keys) {
      if (haveKeys.has(key)) continue;
      ids ??= await stopIdsFor(plan);
      if (await createOccurrence(plan as PlanRow, key, ids)) created++;
    }
    // Sector plans: late-added clients join the days that have not started.
    if (!plan.clientIds && plan.secteurId) {
      const open = have.filter((h) => h.status === "OPEN" && !h.startedAt);
      if (open.length) {
        ids ??= await stopIdsFor(plan);
        for (const h of open) {
          const present = new Set(h.stops.map((s) => s.clientId));
          const missing = ids.filter((id) => !present.has(id));
          if (!missing.length) continue;
          await prisma.tourneeStop.createMany({ data: missing.map((clientId, i) => ({ tourneeId: h.id, clientId, position: h.stops.length + i })) }).catch(() => {});
        }
      }
    }
  }
  return created;
}

/// Make sure one van's tours of one day exist (driver screens, sync).
export async function ensureDayTours(companyId: string, vanId: string, dayKey: string): Promise<void> {
  await materializePlans(companyId, { fromKey: dayKey, toKey: dayKey, vanId }).catch(() => {});
}

export type CreatePlanInput = {
  locationId: string;
  secteurId?: string | null;
  /// The cell's day the admin clicked "YYYY-MM-DD" — week 1 of a biweekly plan.
  dateKey: string;
  intervalWeeks: 1 | 2;
  notes?: string | null;
  clientIds?: string[] | null;
};

/// New recurring tour in a van+weekday cell (max two per cell).
export async function createPlan(companyId: string, input: CreatePlanInput) {
  await ensureLegacyConverted(companyId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey)) throw bad("bad_date");
  if (input.intervalWeeks !== 1 && input.intervalWeeks !== 2) throw bad("bad_frequency");
  const van = await prisma.store.findFirst({ where: { id: input.locationId, companyId, kind: "VAN", isActive: true }, select: { id: true } });
  if (!van) throw bad("van_required");
  if (input.secteurId) {
    const sec = await prisma.secteur.findFirst({ where: { id: input.secteurId, companyId }, select: { id: true } });
    if (!sec) throw bad("bad_secteur");
  } else if (!input.clientIds?.length) {
    throw bad("secteur_required");
  }
  const clientIds = input.clientIds?.length ? [...new Set(input.clientIds)] : null;
  if (clientIds) {
    const n = await prisma.customer.count({ where: { id: { in: clientIds }, companyId } });
    if (n !== clientIds.length) throw bad("bad_client");
  }
  const weekday = weekdayOfKey(input.dateKey);
  const cell = await prisma.tourneePlan.findMany({ where: { companyId, locationId: van.id, weekday, isActive: true }, select: { slot: true } });
  if (cell.length >= MAX_PLANS_PER_CELL) throw bad("cell_full");
  const slot = [0, 1].find((s) => !cell.some((c) => c.slot === s)) ?? 0;
  const plan = await prisma.tourneePlan.create({
    data: {
      companyId, locationId: van.id, secteurId: input.secteurId ?? null, weekday, intervalWeeks: input.intervalWeeks,
      anchorKey: input.dateKey, slot, clientIds: clientIds ? JSON.stringify(clientIds) : null, notes: input.notes ?? null,
    },
  });
  // Week 1 is the clicked day — even when that day is already past this week.
  const today = algiersDayKey(new Date());
  if (input.dateKey < today) await createOccurrence(plan as PlanRow, input.dateKey);
  await materializePlans(companyId, { fromKey: today, toKey: addDaysKey(today, LOOKAHEAD_DAYS), vanId: van.id });
  return plan;
}

/// The hand-picked client list of a plan changed (admin edited the stops of
/// one day): every later, not-yet-started day follows.
export async function updatePlanStops(companyId: string, planId: string, clientIds: string[]): Promise<void> {
  const plan = await prisma.tourneePlan.findFirst({ where: { id: planId, companyId } });
  if (!plan) return;
  const ids = [...new Set(clientIds)];
  await prisma.tourneePlan.update({ where: { id: plan.id }, data: { clientIds: JSON.stringify(ids) } });
  const todayStart = algiersDayRange(new Date()).gte;
  const days = await prisma.tournee.findMany({
    where: { companyId, planId, status: "OPEN", startedAt: null, date: { gte: todayStart } },
    select: { id: true },
  });
  for (const d of days) {
    await prisma.$transaction(async (tx) => {
      await tx.tourneeStop.deleteMany({ where: { tourneeId: d.id } });
      if (ids.length) await tx.tourneeStop.createMany({ data: ids.map((clientId, position) => ({ tourneeId: d.id, clientId, position })) });
    });
  }
}

/// End a plan for good (no new days) and drop its future, not-started days.
/// Days already driven or started stay as history.
export async function deletePlan(companyId: string, planId: string): Promise<void> {
  const plan = await prisma.tourneePlan.findFirst({ where: { id: planId, companyId } });
  if (!plan) return;
  await prisma.tourneePlan.update({ where: { id: plan.id }, data: { isActive: false } });
  const todayStart = algiersDayRange(new Date()).gte;
  await prisma.tournee.deleteMany({ where: { companyId, planId, status: "OPEN", startedAt: null, date: { gte: todayStart } } });
}

/// Remove ONE day of a plan (the plan keeps running): the date is remembered so
/// it is never regenerated.
export async function skipOccurrence(companyId: string, tourneeId: string): Promise<void> {
  const t = await prisma.tournee.findFirst({ where: { id: tourneeId, companyId }, select: { id: true, planId: true, date: true } });
  if (!t) return;
  if (t.planId) {
    const plan = await prisma.tourneePlan.findFirst({ where: { id: t.planId, companyId }, select: { id: true, skips: true } });
    if (plan) await prisma.tourneePlan.update({ where: { id: plan.id }, data: { skips: withSkip(plan.skips, algiersDayKey(t.date)) } });
  }
  await prisma.tournee.delete({ where: { id: t.id } });
}

export type PlanView = {
  id: string; locationId: string; secteurId: string | null; secteurName: string | null;
  weekday: number; intervalWeeks: number; anchorKey: string; slot: number; custom: boolean; isActive: boolean;
};

export async function listPlans(companyId: string): Promise<PlanView[]> {
  const rows = await prisma.tourneePlan.findMany({
    where: { companyId, isActive: true },
    include: { secteur: { select: { name: true } } },
    orderBy: [{ weekday: "asc" }, { slot: "asc" }],
  });
  return rows.map((p) => ({
    id: p.id, locationId: p.locationId, secteurId: p.secteurId, secteurName: p.secteur?.name ?? null,
    weekday: p.weekday, intervalWeeks: p.intervalWeeks, anchorKey: p.anchorKey, slot: p.slot,
    custom: !!p.clientIds, isActive: p.isActive,
  }));
}

export { isPlanDue };
export type { PlanShape };

/// One-time conversion of the OLD behaviour (every live van+weekday tour was
/// copied forward for 12 weeks) into endless weekly plans. Claims a marker
/// first so concurrent requests convert only once; resets it if it fails.
export async function ensureLegacyConverted(companyId: string): Promise<void> {
  let claimed = await prisma.companySettings.updateMany({ where: { companyId, tourPlansMigratedAt: null }, data: { tourPlansMigratedAt: new Date() } });
  if (claimed.count === 0) {
    const exists = await prisma.companySettings.findUnique({ where: { companyId }, select: { id: true } });
    if (exists) return; // already converted (or being converted)
    // No settings row yet: create it, already marked.
    try {
      await prisma.companySettings.create({ data: { companyId, tourPlansMigratedAt: new Date() } });
    } catch {
      return;
    }
    claimed = { count: 1 };
  }
  try {
    await convertLegacyTours(companyId);
  } catch (e) {
    await prisma.companySettings.updateMany({ where: { companyId }, data: { tourPlansMigratedAt: null } }).catch(() => {});
    throw e;
  }
}

/// Every OPEN, plan-less tour from the current week on becomes an endless
/// weekly plan for its van+weekday (latest tour = the template, exactly like
/// the old copy-forward). Past tours, stamps and sales are untouched.
export async function convertLegacyTours(companyId: string): Promise<number> {
  const today = algiersDayKey(new Date());
  const from = algiersDayRange(new Date(`${weekStartKey(today)}T12:00:00Z`)).gte;
  const live = await prisma.tournee.findMany({
    where: { companyId, status: "OPEN", planId: null, date: { gte: from } },
    orderBy: { date: "desc" },
    take: 3000,
    select: { id: true, date: true, locationId: true, secteurId: true, stops: { select: { clientId: true }, orderBy: { position: "asc" } } },
  });
  const groups = new Map<string, typeof live>();
  for (const t of live) {
    const k = `${t.locationId}|${weekdayOfKey(algiersDayKey(t.date))}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  let made = 0;
  for (const [k, list] of groups) {
    const tpl = list[0]; // latest
    const same = list.filter((t) => t.secteurId === tpl.secteurId);
    const keys = same.map((t) => algiersDayKey(t.date)).sort();
    const [vanId, wd] = k.split("|");
    if (!tpl.secteurId && !tpl.stops.length) continue; // nothing to repeat
    const van = await prisma.store.findFirst({ where: { id: vanId, companyId, kind: "VAN", isActive: true }, select: { id: true } });
    if (!van) continue;
    const plan = await prisma.tourneePlan.create({
      data: {
        companyId, locationId: vanId, secteurId: tpl.secteurId, weekday: Number(wd), intervalWeeks: 1, anchorKey: keys[0], slot: 0,
        clientIds: tpl.secteurId ? null : JSON.stringify(tpl.stops.map((s) => s.clientId)),
      },
    });
    for (const t of same) {
      // One by one: a clash on a single row never blocks the others.
      await prisma.tournee.update({ where: { id: t.id }, data: { planId: plan.id, slot: 0 } }).catch(() => {});
    }
    made++;
  }
  return made;
}
