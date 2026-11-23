import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real SQLite: the position recorder behind the APK's always-on location
// service (batches queued offline, retries, wrong phone clocks, locate requests).

const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), "distribuili-track-e2e-"));
const dbFile = join(root, "e2e.db");

type Db = typeof import("@/lib/db");
type Rec = typeof import("@/lib/track-store");
let prisma: Db["prisma"], R: Rec;
const ids = { co: "", van: "" };
const NOW = () => Date.now();

beforeAll(async () => {
  const Database = require("libsql");
  const d = new Database(dbFile);
  d.exec(readFileSync(resolve(__dirname, "../../prisma/sqlite-init.sql"), "utf8"));
  d.close();
  process.env.DISTRIBUILI_DB = "local";
  process.env.DISTRIBUILI_SQLITE_URL = `file:${dbFile}`;
  process.env.DISTRIBUILI_SQLITE_CLIENT = resolve(__dirname, "../../src/generated/prisma-sqlite");
  prisma = (await import("@/lib/db")).prisma;
  R = await import("@/lib/track-store");
  ids.co = (await prisma.company.create({ data: { name: "Track Co" } })).id;
  ids.van = (await prisma.store.create({ data: { companyId: ids.co, name: "Van T", kind: "VAN" } })).id;
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(root, { recursive: true, force: true });
});

const pos = (lat: number, ageMs: number) => ({ lat, lng: 3, accuracy: 8, speed: 20, t: NOW() - ageMs });

describe("van position history", () => {
  it("keeps every fix and mirrors the NEWEST one onto the van", async () => {
    const r = await R.recordPositions(ids.co, ids.van, [pos(36.1, 120_000), pos(36.3, 30_000), pos(36.2, 60_000)]);
    expect(r.kept).toBe(3);
    const van = await prisma.store.findUniqueOrThrow({ where: { id: ids.van } });
    expect(van.lastLat).toBeCloseTo(36.3, 5); // newest by time, not by arrival order
    expect(await prisma.vanPosition.count({ where: { vanId: ids.van } })).toBe(3);
  });

  it("a retried batch (dropped response) is not stored twice", async () => {
    const t = NOW() - 10_000;
    await R.recordPositions(ids.co, ids.van, [{ lat: 36.5, lng: 3, t }]);
    const before = await prisma.vanPosition.count({ where: { vanId: ids.van } });
    const again = await R.recordPositions(ids.co, ids.van, [{ lat: 36.5, lng: 3, t }]);
    expect(again.kept).toBe(0);
    expect(await prisma.vanPosition.count({ where: { vanId: ids.van } })).toBe(before);
  });

  it("an offline backlog (hours old) uploads in order but does not move the live position backwards", async () => {
    const live = await prisma.store.findUniqueOrThrow({ where: { id: ids.van } });
    await R.recordPositions(ids.co, ids.van, [pos(35.0, 3 * 3600_000), pos(35.1, 2 * 3600_000)]);
    const after = await prisma.store.findUniqueOrThrow({ where: { id: ids.van } });
    expect(after.lastLat).toBe(live.lastLat);
    expect(after.lastSeenAt?.getTime()).toBe(live.lastSeenAt?.getTime());
    const first = await prisma.vanPosition.findFirstOrThrow({ where: { vanId: ids.van }, orderBy: { recordedAt: "asc" } });
    expect(first.lat).toBeCloseTo(35.0, 5);
  });

  it("a phone with a wrong clock cannot put points in the future or months back", async () => {
    const before = await prisma.vanPosition.count({ where: { vanId: ids.van } });
    await R.recordPositions(ids.co, ids.van, [
      { lat: 40, lng: 3, t: NOW() + 5 * 86_400_000 }, // future → clamped to now
      { lat: 41, lng: 3, t: NOW() - 90 * 86_400_000 }, // too old → dropped
    ]);
    expect(await prisma.vanPosition.count({ where: { vanId: ids.van } })).toBe(before + 1);
    const latest = await prisma.vanPosition.findFirstOrThrow({ where: { vanId: ids.van }, orderBy: { recordedAt: "desc" } });
    expect(latest.recordedAt.getTime()).toBeLessThanOrEqual(NOW() + 1000);
  });

  it("a fresh fix answers a locate request; an old queued fix does not", async () => {
    await prisma.store.update({ where: { id: ids.van }, data: { locateRequestedAt: new Date() } });
    await R.recordPositions(ids.co, ids.van, [pos(36.0, 60 * 60_000)]); // an hour old
    expect((await prisma.store.findUniqueOrThrow({ where: { id: ids.van } })).locateRequestedAt).not.toBeNull();
    await R.recordPositions(ids.co, ids.van, [{ lat: 36.9, lng: 3.1, t: NOW() }]);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: ids.van } })).locateRequestedAt).toBeNull();
  });

  it("stores the phone's own health report for the office", async () => {
    await R.recordPositions(ids.co, ids.van, [], { fine: true, always: false, battery: true, service: true, queued: 4, app: "1.20" });
    const van = await prisma.store.findUniqueOrThrow({ where: { id: ids.van } });
    const st = JSON.parse(van.lastTrackState ?? "{}");
    expect(st.always).toBe(false);
    expect(st.queued).toBe(4);
    expect(typeof st.at).toBe("string");
  });
});
