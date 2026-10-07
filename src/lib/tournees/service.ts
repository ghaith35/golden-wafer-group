import { prisma } from "@/lib/db";
import { z } from "zod";
import { tourneeSchema, tourneeStopsSchema, stopUpdateSchema } from "@/lib/sales/validation";

type TourneeInput = z.infer<typeof tourneeSchema>;

export async function createTournee(companyId: string, input: TourneeInput) {
  const location = await prisma.store.findFirst({ where: { id: input.locationId, companyId, kind: "VAN" } });
  if (!location) throw Object.assign(new Error("van_required"), { status: 400 });
  if (input.secteurId) {
    const sec = await prisma.secteur.findFirst({ where: { id: input.secteurId, companyId } });
    if (!sec) throw Object.assign(new Error("bad_secteur"), { status: 400 });
  }
  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error("bad_date"), { status: 400 });

  // One open tour per van per day — the board assumes a single column owner.
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const clash = await prisma.tournee.findFirst({
    where: { companyId, locationId: input.locationId, status: "OPEN", date: { gte: dayStart, lt: dayEnd } },
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
      const next = new Date(tournee.date);
      next.setDate(next.getDate() + 1);
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

export async function startDay(
  companyId: string,
  userId: string,
  role: string,
  tourneeId: string,
  occurredAt?: Date | null,
) {
  const tournee = await assertCanStamp(companyId, userId, role, tourneeId);
  // Idempotent: a retried/duplicated offline stamp is a success, not an error.
  if (tournee.startedAt) return tournee;
  if (tournee.status !== "OPEN") throw Object.assign(new Error("bad_status"), { status: 400 });
  return prisma.tournee.update({ where: { id: tournee.id }, data: { startedAt: occurredAt ?? new Date() } });
}

export async function finishDay(
  companyId: string,
  userId: string,
  role: string,
  tourneeId: string,
  occurredAt?: Date | null,
) {
  const tournee = await assertCanStamp(companyId, userId, role, tourneeId);
  if (tournee.finishedAt) return tournee;
  if (tournee.status !== "OPEN") throw Object.assign(new Error("bad_status"), { status: 400 });
  if (!tournee.startedAt) throw Object.assign(new Error("not_started"), { status: 400 });
  return prisma.tournee.update({ where: { id: tournee.id }, data: { finishedAt: occurredAt ?? new Date() } });
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
  return prisma.tournee.update({ where: { id: tournee.id }, data: { startedAt, finishedAt } });
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
