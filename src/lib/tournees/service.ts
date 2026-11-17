import { prisma } from "@/lib/db";
import { z } from "zod";
import { tourneeSchema, tourneeStopsSchema, stopUpdateSchema } from "@/lib/sales/validation";
import { addDaysKey, algiersDayKey, algiersDayRange, endOfAlgiersDay, isPastAlgiersDay, weekStartKey } from "./days";

type TourneeInput = z.infer<typeof tourneeSchema>;

export async function createTournee(companyId: string, input: TourneeInput) {
  const location = await prisma.store.findFirst({ where: { id: input.locationId, companyId, kind: "VAN", isActive: true } });
  if (!location) throw Object.assign(new Error("van_required"), { status: 400 });
  if (input.secteurId) {
    const sec = await prisma.secteur.findFirst({ where: { id: input.secteurId, companyId } });
    if (!sec) throw Object.assign(new Error("bad_secteur"), { status: 400 });
  }
  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error("bad_date"), { status: 400 });

  // One open tour per van per day — the board assumes a single column owner.
  const clash = await prisma.tournee.findFirst({
    where: { companyId, locationId: input.locationId, status: "OPEN", date: algiersDayRange(date) },
    select: { id: true },
  });
  if (clash) throw Object.assign(new Error("duplicate_day"), { status: 400 });

  let clientIds = [...new Set(input.clientIds ?? [])];
  if (!clientIds.length && input.secteurId) {
    const clients = await prisma.customer.findMany({
      where: { companyId, secteurId: input.secteurId, isActive: true },
      select: { id: true },
      take: 500,
    });
    clientIds = clients.map((c) => c.id);
  }
  const clients = clientIds.length
    ? await prisma.customer.findMany({ where: { id: { in: clientIds }, companyId }, select: { id: true } })
    : [];
  if (clients.length !== clientIds.length) throw Object.assign(new Error("bad_client"), { status: 400 });

  return prisma.$transaction(async (tx) => {
    const tournee = await tx.tournee.create({
      data: {
        companyId,
        date,
        locationId: location.id,
        secteurId: input.secteurId ?? null,
        notes: input.notes ?? null,
      },
    });
    for (let i = 0; i < clientIds.length; i++) {
      await tx.tourneeStop.create({ data: { tourneeId: tournee.id, clientId: clientIds[i], position: i } });
    }
    return tx.tournee.findUniqueOrThrow({
      where: { id: tournee.id },
      include: { stops: { include: { client: true }, orderBy: { position: "asc" } }, location: true, secteur: true },
    });
  });
}

export async function setStops(companyId: string, tourneeId: string, clientIds: string[]) {
  const tournee = await prisma.tournee.findFirst({ where: { id: tourneeId, companyId } });
  if (!tournee) throw Object.assign(new Error("not_found"), { status: 404 });
  if (tournee.status !== "OPEN") throw Object.assign(new Error("bad_status"), { status: 400 });
  const ids = [...new Set(clientIds)];
  const clients = ids.length
    ? await prisma.customer.findMany({ where: { id: { in: ids }, companyId }, select: { id: true } })
    : [];
  if (clients.length !== ids.length) throw Object.assign(new Error("bad_client"), { status: 400 });
  return prisma.$transaction(async (tx) => {
    await tx.tourneeStop.deleteMany({ where: { tourneeId } });
    for (let i = 0; i < ids.length; i++) {
      await tx.tourneeStop.create({ data: { tourneeId, clientId: ids[i], position: i } });
    }
    return tx.tournee.findUniqueOrThrow({
      where: { id: tourneeId },
      include: { stops: { include: { client: true }, orderBy: { position: "asc" } }, location: true, secteur: true },
    });
  });
}

export async function updateStop(
  companyId: string,
  stopId: string,
  input: z.infer<typeof stopUpdateSchema>,
) {
  const stop = await prisma.tourneeStop.findFirst({ where: { id: stopId, tournee: { companyId } } });
  if (!stop) throw Object.assign(new Error("not_found"), { status: 404 });
  return prisma.tourneeStop.update({
    where: { id: stop.id },
    data: {
      ...(input.visited !== undefined ? { visited: input.visited } : {}),
      ...(input.sold !== undefined ? { sold: input.sold } : {}),
      ...(input.skipped !== undefined ? { skipped: input.skipped } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    },
  });
}

export async function reorderStops(companyId: string, tourneeId: string, orderedIds: string[]) {
  const tournee = await prisma.tournee.findFirst({
    where: { id: tourneeId, companyId },
    include: { stops: true },
  });
  if (!tournee) throw Object.assign(new Error("not_found"), { status: 404 });
  if (tournee.status !== "OPEN") throw Object.assign(new Error("bad_status"), { status: 400 });
  const existing = new Set(tournee.stops.map((s) => s.id));
  if (orderedIds.length !== existing.size || !orderedIds.every((id) => existing.has(id))) {
    throw Object.assign(new Error("bad_order"), { status: 400 });
  }
  return prisma.$transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.tourneeStop.update({ where: { id: orderedIds[i] }, data: { position: i } });
    }
    return tx.tournee.findUniqueOrThrow({
      where: { id: tourneeId },
      include: { stops: { include: { client: true }, orderBy: { position: "asc" } } },
    });
  });
}

/// Close: visit report + unvisited carry-over to a next-day draft.
export async function closeTournee(companyId: string, tourneeId: string) {
  const tournee = await prisma.tournee.findFirst({
    where: { id: tourneeId, companyId },
    include: { stops: { include: { client: true } }, sales: true },
  });
  if (!tournee) throw Object.assign(new Error("not_found"), { status: 404 });
  if (tournee.status !== "OPEN") throw Object.assign(new Error("bad_status"), { status: 400 });

  const visited = tournee.stops.filter((s) => s.visited).length;
  const sold = tournee.stops.filter((s) => s.sold).length;
  const skipped = tournee.stops.filter((s) => s.skipped).length;
  const unvisited = tournee.stops.filter((s) => !s.visited && !s.skipped);
  const salesTotal = tournee.sales.reduce((s, x) => s + Number(x.total), 0);

  return prisma.$transaction(async (tx) => {
    await tx.tournee.update({ where: { id: tournee.id }, data: { status: "CLOSED" } });
    let carryoverId: string | null = null;
    if (unvisited.length) {
      const next = new Date(tournee.date.getTime() + 86_400_000);
      // Reuse an already-open tour of this van tomorrow (the board shows one
      // per cell) — append the unvisited clients it doesn't have yet.
      const existing = await tx.tournee.findFirst({
        where: { companyId, locationId: tournee.locationId, status: "OPEN", date: algiersDayRange(next) },
        include: { stops: { select: { clientId: true } } },
      });
      if (existing) {
        const have = new Set(existing.stops.map((s) => s.clientId));
        let pos = existing.stops.length;
        for (const u of unvisited) {
          if (have.has(u.clientId)) continue;
          await tx.tourneeStop.create({ data: { tourneeId: existing.id, clientId: u.clientId, position: pos++ } });
        }
        carryoverId = existing.id;
      } else {
        const draft = await tx.tournee.create({
          data: {
            companyId,
            date: next,
            locationId: tournee.locationId,
            secteurId: tournee.secteurId,
            notes: `Carry-over from ${tournee.date.toISOString().slice(0, 10)}`,
          },
        });
        for (let i = 0; i < unvisited.length; i++) {
          await tx.tourneeStop.create({ data: { tourneeId: draft.id, clientId: unvisited[i].clientId, position: i } });
        }
        carryoverId = draft.id;
      }
    }
    return {
      report: { visited, sold, skipped, unvisited: unvisited.length, salesTotal, sales: tournee.sales.length },
      carryoverId,
    };
  });
}

/// Day tracking: the livreur/vendeur stamps départ (start) and fin (finish)
/// on their van's tournée. Allowed for Admins or staff assigned to the van.
async function assertCanStamp(companyId: string, userId: string, role: string, tourneeId: string) {
  const tournee = await prisma.tournee.findFirst({ where: { id: tourneeId, companyId } });
  if (!tournee) throw Object.assign(new Error("not_found"), { status: 404 });
  if (role !== "Admin") {
    const owned = await prisma.store.findFirst({
      where: { id: tournee.locationId, companyId, userId },
    });
    if (!owned) throw Object.assign(new Error("forbidden"), { status: 403 });
  }
  return tournee;
}

export type DayStamp = { lat?: unknown; lng?: unknown };

function cleanCoord(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function startDay(
  companyId: string,
  userId: string,
  role: string,
  tourneeId: string,
  occurredAt?: Date | null,
  stamp?: DayStamp | null,
) {
  // Rolling over: yesterday's unfinished journée ends here, flagged —
  // a new day never starts on top of a dangling one.
  await closeStaleDays(companyId).catch(() => {});
  const tournee = await assertCanStamp(companyId, userId, role, tourneeId);
  // Idempotent: a retried/duplicated offline stamp is a success, not an error.
  if (tournee.startedAt) return tournee;
  if (tournee.status !== "OPEN") throw Object.assign(new Error("bad_status"), { status: 400 });
  const lat = cleanCoord(stamp?.lat);
  const lng = cleanCoord(stamp?.lng);
  return prisma.tournee.update({
    where: { id: tournee.id },
    data: {
      startedAt: occurredAt ?? new Date(),
      ...(lat != null && lng != null ? { startedLat: lat, startedLng: lng } : {}),
    },
  });
}

export async function finishDay(
  companyId: string,
  userId: string,
  role: string,
  tourneeId: string,
  occurredAt?: Date | null,
  stamp?: DayStamp | null,
) {
  await closeStaleDays(companyId).catch(() => {});
  const tournee = await assertCanStamp(companyId, userId, role, tourneeId);
  // Already ended (manually or by the system): idempotent success, and an
  // auto-close flag is NEVER cleared by a late stamp.
  if (tournee.finishedAt) return tournee;
  if (tournee.status !== "OPEN") throw Object.assign(new Error("bad_status"), { status: 400 });
  if (!tournee.startedAt) throw Object.assign(new Error("not_started"), { status: 400 });
  const lat = cleanCoord(stamp?.lat);
  const lng = cleanCoord(stamp?.lng);
  // A journée finished after its own calendar day counts as unended-in-time:
  // record the stamp but keep it flagged for the admin.
  const late = isPastAlgiersDay(new Date(tournee.date));
  return prisma.tournee.update({
    where: { id: tournee.id },
    data: {
      finishedAt: occurredAt ?? new Date(),
      ...(late ? { autoClosed: true } : {}),
      ...(lat != null && lng != null ? { finishedLat: lat, finishedLng: lng } : {}),
    },
  });
}

/// Auto-close: every started-but-unfinished journée from a past Algiers day
/// ends at 23:59:59 of its own day, flagged for the admin. Runs lazily from
/// startDay/finishDay (every deployment, no cron) and from the admin boards
/// on load (so flags appear even if the driver never returns).
export async function closeStaleDays(companyId: string, now = new Date()): Promise<{ closed: string[] }> {
  const today = algiersDayKey(now);
  // Small bounded set (one row per van per day): filter the calendar day in
  // JS so server/shop-PC timezones can never shift the boundary.
  const open = await prisma.tournee.findMany({
    where: { companyId, status: "OPEN", startedAt: { not: null }, finishedAt: null },
    select: { id: true, date: true },
    orderBy: { date: "asc" },
    take: 500,
  });
  const closed: string[] = [];
  for (const t of open) {
    let key = "";
    try {
      key = algiersDayKey(new Date(t.date));
    } catch {
      continue;
    }
    if (key >= today) continue;
    try {
      await prisma.tournee.update({
        where: { id: t.id },
        data: { finishedAt: endOfAlgiersDay(new Date(t.date)), autoClosed: true },
      });
      closed.push(t.id);
    } catch {
      /* one bad row never blocks the rest */
    }
  }
  return { closed };
}

/// Admin manual correction of départ / fin de journée (presence board).
/// Null clears that stamp. Finished must not precede started.
export async function setTourneeTimes(
  companyId: string,
  tourneeId: string,
  startedAt: Date | null,
  finishedAt: Date | null
) {
  const tournee = await prisma.tournee.findFirst({ where: { id: tourneeId, companyId } });
  if (!tournee) throw Object.assign(new Error("not_found"), { status: 404 });
  if (startedAt && Number.isNaN(startedAt.getTime())) throw Object.assign(new Error("bad_time"), { status: 400 });
  if (finishedAt && Number.isNaN(finishedAt.getTime())) throw Object.assign(new Error("bad_time"), { status: 400 });
  if (startedAt && finishedAt && finishedAt < startedAt) throw Object.assign(new Error("bad_range"), { status: 400 });
  // Explicit admin correction takes ownership: a reviewed/corrected day is
  // no longer "unended" — the flag clears, the stamps stay as set.
  return prisma.tournee.update({ where: { id: tournee.id }, data: { startedAt, finishedAt, autoClosed: false } });
}

export { tourneeStopsSchema };

/// Move one stop to another (open) tour, preserving its visited/sold state.
/// Used by day-to-day drag-and-drop on the planning board.
export async function moveStop(companyId: string, stopId: string, toTourneeId: string) {
  const stop = await prisma.tourneeStop.findFirst({
    where: { id: stopId, tournee: { companyId } },
    include: { tournee: { select: { id: true, status: true } } },
  });
  if (!stop) throw Object.assign(new Error("not_found"), { status: 404 });
  if (stop.tournee.status !== "OPEN") throw Object.assign(new Error("bad_status"), { status: 400 });
  const dest = await prisma.tournee.findFirst({ where: { id: toTourneeId, companyId } });
  if (!dest) throw Object.assign(new Error("bad_target"), { status: 404 });
  if (dest.status !== "OPEN") throw Object.assign(new Error("bad_status"), { status: 400 });
  if (stop.tourneeId === toTourneeId) return { ok: true, noop: true };
  // Destination already has this client (repeating weekly schedules) →
  // merge: drop the source stop, keep the destination one.
  const dup = await prisma.tourneeStop.findFirst({
    where: { tourneeId: toTourneeId, clientId: stop.clientId },
    select: { id: true },
  });
  if (dup) {
    await prisma.tourneeStop.delete({ where: { id: stopId } });
    const remaining = await prisma.tourneeStop.count({ where: { tourneeId: stop.tourneeId } });
    return { ok: true, merged: true, sourceEmpty: remaining === 0 };
  }
  const position = await prisma.tourneeStop.count({ where: { tourneeId: toTourneeId } });
  await prisma.tourneeStop.update({ where: { id: stopId }, data: { tourneeId: toTourneeId, position } });
  const remaining = await prisma.tourneeStop.count({ where: { tourneeId: stop.tourneeId } });
  return { ok: true, sourceEmpty: remaining === 0 };
}

/// One weekly plan for every week. The "live plan" of a van is its OPEN tours
/// from the current week onward; each van+weekday cell is copied forward
/// (same secteur, else same stops) for `weeks` weeks starting at weekKey, only
/// for days that are not in the past. Deleting a cell (all its open future
/// tours) ends that plan — nothing is regenerated from history.
export async function ensureWeekTours(companyId: string, weekKey: string, weeks = 1): Promise<number> {
  const today = algiersDayKey(new Date());
  const thisWeek = weekStartKey(today);
  const from = algiersDayRange(new Date(`${thisWeek}T12:00:00Z`)).gte;
  const live = await prisma.tournee.findMany({
    where: { companyId, status: "OPEN", date: { gte: from } },
    orderBy: { date: "desc" },
    take: 2000,
    select: { date: true, locationId: true, secteurId: true, stops: { select: { clientId: true }, orderBy: { position: "asc" } } },
  });
  type Tpl = { secteurId: string | null; clientIds: string[] };
  const templates = new Map<string, Tpl>(); // `${vanId}|${offset}` → latest
  for (const t of live) {
    const key = algiersDayKey(t.date);
    const offset = (new Date(`${key}T00:00:00Z`).getUTCDay() + 1) % 7;
    const k = `${t.locationId}|${offset}`;
    if (!templates.has(k)) templates.set(k, { secteurId: t.secteurId, clientIds: t.stops.map((x) => x.clientId) });
  }
  if (!templates.size) return 0;
  const first = weekKey < thisWeek ? thisWeek : weekKey;
  const lastDay = addDaysKey(first, 7 * weeks - 1);
  const startR = algiersDayRange(new Date(`${first}T12:00:00Z`)).gte;
  const endR = algiersDayRange(new Date(`${lastDay}T12:00:00Z`)).lt;
  const existing = await prisma.tournee.findMany({
    where: { companyId, date: { gte: startR, lt: endR } },
    select: { date: true, locationId: true },
  });
  const have = new Set(existing.map((e) => `${e.locationId}|${algiersDayKey(e.date)}`));
  let created = 0;
  for (let w = 0; w < weeks; w++) {
    for (const [k, tpl] of templates) {
      const [vanId, off] = k.split("|");
      const dayKey = addDaysKey(first, 7 * w + Number(off));
      if (dayKey < today || have.has(`${vanId}|${dayKey}`)) continue;
      try {
        await createTournee(companyId, {
          locationId: vanId,
          date: dayKey,
          secteurId: tpl.secteurId ?? undefined,
          clientIds: tpl.secteurId ? [] : tpl.clientIds,
        } as never);
        have.add(`${vanId}|${dayKey}`);
        created++;
      } catch {
        // van archived / client gone / duplicate → skip this cell
      }
    }
  }
  return created;
}

/// Other tours of the same van + weekday that are still part of the plan:
/// OPEN, not started, today or later.
async function seriesSiblings(companyId: string, tourneeId: string) {
  const t = await prisma.tournee.findFirst({ where: { id: tourneeId, companyId } });
  if (!t) return [];
  const offset = (new Date(`${algiersDayKey(t.date)}T00:00:00Z`).getUTCDay() + 1) % 7;
  const from = algiersDayRange(new Date(`${algiersDayKey(new Date())}T12:00:00Z`)).gte;
  const rows = await prisma.tournee.findMany({
    where: { companyId, locationId: t.locationId, status: "OPEN", startedAt: null, date: { gte: from }, id: { not: t.id } },
    select: { id: true, date: true },
  });
  return rows.filter((r) => (new Date(`${algiersDayKey(r.date)}T00:00:00Z`).getUTCDay() + 1) % 7 === offset).map((r) => r.id);
}

/// Edit once → every future week follows (stops of the cell copied over).
export async function propagateStops(companyId: string, tourneeId: string) {
  const src = await prisma.tournee.findFirst({
    where: { id: tourneeId, companyId },
    include: { stops: { orderBy: { position: "asc" }, select: { clientId: true } } },
  });
  if (!src || src.status !== "OPEN") return;
  for (const id of await seriesSiblings(companyId, tourneeId)) {
    await prisma.$transaction(async (tx) => {
      await tx.tourneeStop.deleteMany({ where: { tourneeId: id } });
      for (let i = 0; i < src.stops.length; i++) {
        await tx.tourneeStop.create({ data: { tourneeId: id, clientId: src.stops[i].clientId, position: i } });
      }
      await tx.tournee.update({ where: { id }, data: { secteurId: src.secteurId } });
    });
  }
}

/// Delete a cell from the plan: this tour plus every future open copy.
export async function deleteSeries(companyId: string, tourneeId: string) {
  const ids = await seriesSiblings(companyId, tourneeId);
  await prisma.tournee.deleteMany({ where: { companyId, id: { in: [...ids, tourneeId] } } });
}
