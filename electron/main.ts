import { app, BrowserWindow, Menu, nativeImage, shell, ipcMain, Tray } from "electron";
import { TRAY_ICON_B64 } from "./tray-icon";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import * as license from "./license";
import { configureUpdater } from "./updater";
import { migrateSqliteSchema } from "./sqlite-migrate";

// Central license server (holds the private key). Default: the company's
// own Distribuili server. Override per-install via <userData>/license-server.json
// { "url": "https://..." } or the DISTRIBUILI_LICENSE_URL env var.
const DEFAULT_LICENSE_URL = "https://licence.distribuili.dz";

// The build mode is baked into each installer via build-mode.json
// (set by scripts/set-mode.mjs before packaging):
//   local  → offline SQLite desktop (full standalone server + license gate)
//   server → thin client to the cloud/SaaS domain (no local server, no gate)
function readBuildMode(): { mode: "local" | "server"; serverUrl: string } {
  const p = app.isPackaged
    ? join(process.resourcesPath, "build-mode.json")
    : join(__dirname, "..", "..", "build-mode.json");
  try {
    const c = JSON.parse(readFileSync(p, "utf8")) as { mode?: string; serverUrl?: string };
    return { mode: c.mode === "server" ? "server" : "local", serverUrl: c.serverUrl || "https://votre-domaine.com" };
  } catch {
    return { mode: "local", serverUrl: "https://votre-domaine.com" };
  }
}

let appMode: "local" | "server" = "local";
let serverUrl = "";
let userDataDir = "";
let machineId = "";

// ── Client-set server address ─────────────────────────────────────────────
// The customer points THEIR install at THEIR server (domain or LAN IP) —
// never baked in. Stored in <userData>/server-url.txt, editable from the
// setup page (shown on first run / when the server is unreachable).
function serverUrlFile(): string {
  return join(userDataDir, "server-url.txt");
}

export function readServerUrlOverride(): string {
  try {
    const s = readFileSync(serverUrlFile(), "utf8").trim().replace(/\/$/, "");
    if (/^https?:\/\/[^/]+$/i.test(s)) return s;
    const withProto = s && !/:\/\//.test(s) ? `http://${s}` : s;
    if (/^https?:\/\/[^/]+$/i.test(withProto)) return withProto;
  } catch {
    /* no override yet */
  }
  return "";
}

function writeServerUrlOverride(url: string): void {
  const clean = String(url || "").trim().replace(/\/$/, "");
  if (!/^https?:\/\/[^/]+(:\d+)?$/i.test(clean)) throw new Error("bad_url");
  writeFileSync(serverUrlFile(), clean, "utf8");
}

/// Effective server: client override wins over the baked build-mode URL.
function effServerUrl(): string {
  return readServerUrlOverride() || serverUrl || "https://votre-domaine.com";
}

/// Setup page (written to userData, loaded on failure): enter the server
/// address (domain or http://IP:port), save, reconnect.
function setupPageHtml(current: string, error: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Distribuili — Server</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#1e293b;border-radius:16px;padding:28px;max-width:420px;width:92%;box-shadow:0 10px 40px #0008}
h1{font-size:18px;margin:0 0 6px}p{font-size:13px;opacity:.7;margin:0 0 14px}
input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:14px;direction:ltr}
button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;background:#65a30d;color:#fff;font-size:15px;font-weight:800;cursor:pointer}
.err{color:#f87171;font-size:13px;min-height:20px;margin-top:8px}</style></head>
<body><div class="card"><h1>🖥️ عنوان السيرفر</h1>
<p>أدخل عنوان السيرفر (دومين أو IP الشبكة) — مثال:<br><code dir="ltr">https://vente.mondomaine.dz</code> أو <code dir="ltr">http://192.168.1.50:32517</code></p>
<input id="u" dir="ltr" placeholder="https://…" value="${esc(current)}">
<div class="err" id="e">${esc(error)}</div>
<button onclick="go()">اتصال ✓</button></div>
<script>
async function go(){
  const v=document.getElementById('u').value.trim();
  const r=await window.distribuili.serverSaveUrl(v);
  if(r&&r.ok){ location.href=v.replace(/\\/$/,'')+'/ar/dashboard'; }
  else document.getElementById('e').textContent='رابط غير صالح';
}
document.getElementById('u').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
window.distribuili.serverGetUrl().then(r=>{ if(r&&r.url&&!document.getElementById('u').value) document.getElementById('u').value=r.url; });
</script></body></html>`;
}

function showServerSetup(error = ""): void {
  try {
    writeFileSync(join(userDataDir, "setup-server.html"), setupPageHtml(readServerUrlOverride() || serverUrl, error), "utf8");
    mainWindow?.loadFile(join(userDataDir, "setup-server.html")).catch(() => {});
  } catch {
    /* ignore */
  }
}

function registerServerUrlIpc(): void {
  ipcMain.handle("server-get-url", () => ({ ok: true, url: effServerUrl() }));
  ipcMain.handle("server-save-url", (_e, url: string) => {
    try {
      writeServerUrlOverride(String(url || ""));
      return { ok: true, url: effServerUrl() };
    } catch {
      return { ok: false, error: "bad_url" };
    }
  });
}

// ── Always-on PC (auto-logon) ─────────────────────────────────────────────
// The installer runs elevated but never sees the Windows password, so the
// password step happens here on first boot: a native dialog offers it, and
// an ELEVATED PowerShell (UAC prompt = the "ask for administration") writes
// the Winlogon keys. State in userData/alwayson.json.
function alwaysOnFile(): string {
  return join(userDataDir, "alwayson.json");
}

function alwaysOnState(): { asked?: boolean; done?: boolean } {
  try {
    return JSON.parse(readFileSync(alwaysOnFile(), "utf8")) as { asked?: boolean; done?: boolean };
  } catch {
    return {};
  }
}

function setAlwaysOnState(patch: { asked?: boolean; done?: boolean }): void {
  try {
    writeFileSync(alwaysOnFile(), JSON.stringify({ ...alwaysOnState(), ...patch }), "utf8");
  } catch {
    /* best-effort */
  }
}

const AUTOLOGON_PS1 = [
  "$ErrorActionPreference = 'Stop'",
  "$u = $env:USERNAME",
  "$s = Read-Host \"Windows password for $u (auto-logon after reboot)\" -AsSecureString",
  "$p = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))",
  "if (-not $p) { Write-Host 'Empty - cancelled.'; exit 1 }",
  "$wl = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'",
  "Set-ItemProperty -Path $wl -Name 'AutoAdminLogon' -Value '1' -Type String",
  "Set-ItemProperty -Path $wl -Name 'DefaultUserName' -Value $u -Type String",
  "Set-ItemProperty -Path $wl -Name 'DefaultDomainName' -Value $env:COMPUTERNAME -Type String",
  "Set-ItemProperty -Path $wl -Name 'DefaultPassword' -Value $p -Type String",
  "Write-Host 'Auto-logon enabled.'",
].join("\r\n");

function offerAlwaysOn(log: (m: string) => void): void {
  if (process.platform !== "win32" || !mainWindow) return;
  if (alwaysOnState().asked) return;
  setAlwaysOnState({ asked: true });
  const { dialog } = require("electron") as typeof import("electron");
  dialog
    .showMessageBox(mainWindow, {
      type: "question",
      buttons: ["تفعيل التشغيل الدائم", "لاحقاً"],
      defaultId: 0,
      cancelId: 1,
      title: "Distribuili",
      message: "تشغيل دائم لهذا الكمبيوتر؟",
      detail:
        "سيطلب ويندوز صلاحية المسؤول (UAC)، ثم تُدخل كلمة السر مرة واحدة في النافذة السوداء. بعدها: أي إعادة تشغيل تدخل تلقائياً ويعود السيرفر وحده.",
    })
    .then(({ response }: { response: number }) => {
      if (response !== 0) return;
      try {
        const ps1 = join(userDataDir, "enable-autologon.ps1");
        writeFileSync(ps1, AUTOLOGON_PS1, "utf8");
        const { spawn } = require("node:child_process") as typeof import("node:child_process");
        // Verb RunAs = the admin prompt; -NoExit keeps the console so the
        // user sees success/failure of the password step.
        spawn("powershell.exe", ["-NoExit", "-ExecutionPolicy", "Bypass", "-File", ps1], {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        }).unref();
        setAlwaysOnState({ done: true });
        log("[alwayson] elevated helper launched");
      } catch (e) {
        log(`[alwayson] launch failed: ${String(e)}`);
      }
    })
    .catch(() => {});
}

function licenseServerUrl(): string {
  const env = (process.env.DISTRIBUILI_LICENSE_URL || "").trim();
  if (env) return env.replace(/\/$/, "");
  try {
    const f = join(userDataDir, "license-server.json");
    if (existsSync(f)) {
      const raw = JSON.parse(readFileSync(f, "utf8")) as { url?: string };
      if (raw.url) return String(raw.url).replace(/\/$/, "");
    }
  } catch { /* fall through to default */ }
  return DEFAULT_LICENSE_URL;
}

function getStableMachineId(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { machineIdSync } = require("node-machine-id");
    const id = machineIdSync(true);
    if (id) return String(id);
  } catch { /* fall through to persisted id */ }
  const f = join(userDataDir, "machine.id");
  try {
    if (existsSync(f)) return readFileSync(f, "utf8").trim();
    const id = crypto.randomBytes(20).toString("hex");
    writeFileSync(f, id, "utf8");
    return id;
  } catch { return "unknown-machine"; }
}

function entitled(): boolean {
  if (readLockFlag()) return false;
  if (isRevoked()) return false;
  const e = license.getEntitlement(userDataDir, machineId);
  return e.activated || e.inTrial;
}

// ── Sticky lock flag (safeStorage-encrypted) ──────────────────────────────
// A plaintext revoked.flag proved too easy to delete-and-replant; the flag
// now lives encrypted via the OS keychain. Wiping .lic files alone is NOT
// enough — only a FRESH server-signed token clears this.
function lockFlagFile(): string { return join(userDataDir, "revoked.dat"); }

function readLockFlag(): boolean {
  try {
    const { safeStorage } = require("electron") as typeof import("electron");
    if (!safeStorage.isEncryptionAvailable()) return isRevoked();
    const raw = require("node:fs").readFileSync(lockFlagFile());
    return safeStorage.decryptString(raw) === "revoked";
  } catch {
    return isRevoked();
  }
}

function writeLockFlag(): void {
  try {
    const { safeStorage } = require("electron") as typeof import("electron");
    if (safeStorage.isEncryptionAvailable()) {
      require("node:fs").writeFileSync(lockFlagFile(), safeStorage.encryptString("revoked"));
      return;
    }
  } catch { /* fall through to plaintext marker */ }
  markRevoked();
}

function clearLockFlag(): void {
  try {
    require("node:fs").rmSync(lockFlagFile(), { force: true });
  } catch { /* best-effort */ }
  clearRevoked();
}

/// Remote kill-switch: wipe every token + clock, set the sticky flag, steer
/// to /activate. Survives offline AND file replanting — only a fresh server
/// token (unrevoke) resurrects the install.
function enforceLock(log: (m: string) => void): void {
  writeLockFlag();
  license.wipeAllTokens(userDataDir);
  log("[license] REVOKED by server — install locked");
  routeByEntitlement();
}

// ── Revocation persistence (survives offline / token replanting) ────────────
function revokedFlagFile(): string { return join(userDataDir, "revoked.flag"); }
function isRevoked(): boolean {
  try { return existsSync(revokedFlagFile()); } catch { return false; }
}
function markRevoked(): void {
  try { writeFileSync(revokedFlagFile(), String(Date.now()), "utf8"); } catch { /* best-effort */ }
}
function clearRevoked(): void {
  try { writeFileSync(revokedFlagFile(), "", "utf8"); } catch { /* best-effort */ }
  try { require("node:fs").rmSync(revokedFlagFile(), { force: true }); } catch { /* best-effort */ }
}

function routeByEntitlement(): void {
  if (!mainWindow || !serverPort) return;
  const url = `http://127.0.0.1:${serverPort}`;
  mainWindow.loadURL(entitled() ? `${url}/ar/dashboard` : `${url}/ar/activate`).catch(() => {});
}

function registerLicenseIpc(): void {
  ipcMain.handle("license-status", () => {
    const e = license.getEntitlement(userDataDir, machineId);
    if (readLockFlag()) return { ...e, activated: false, inTrial: false, locked: true, machineId };
    if (isRevoked()) return { ...e, activated: false, inTrial: false, machineId };
    return { ...e, machineId, serverUrl: licenseServerUrl() };
  });
  ipcMain.handle("license-register", async (_e, label?: string, phone?: string) => {
    await license.registerMachine(licenseServerUrl(), machineId, String(label ?? ""), phone?.trim() || undefined);
    return { ...license.getEntitlement(userDataDir, machineId), machineId };
  });
  ipcMain.handle("license-start-trial", async (_e, info: license.TrialInfo) => {
    const r = await license.requestTrial(licenseServerUrl(), machineId, info || {});
    if (r.token) { clearRevoked(); license.writeTrial(userDataDir, r.token); }
    if (r.activated) {
      const t = await license.issueActivation(licenseServerUrl(), machineId);
      if (t) { clearRevoked(); license.writeActivation(userDataDir, t); }
    }
    return { ...license.getEntitlement(userDataDir, machineId), machineId, error: r.error, revoked: r.revoked };
  });
  ipcMain.handle("license-check", async () => {
    const t = await license.issueActivation(licenseServerUrl(), machineId);
    if (t) { clearRevoked(); license.writeActivation(userDataDir, t); }
    return { ...license.getEntitlement(userDataDir, machineId), machineId };
  });
  ipcMain.handle("license-enter-key", (_e, token: string) => {
    const tok = String(token || "").trim();
    if (license.verifyActivationToken(tok, machineId)) { clearRevoked(); license.writeActivation(userDataDir, tok); }
    else if (license.verifyTrialToken(tok, machineId)) { clearRevoked(); license.writeTrial(userDataDir, tok); }
    return { ...license.getEntitlement(userDataDir, machineId), machineId };
  });
  ipcMain.handle("license-redeem-key", async (_e, key: string, label?: string) => {
    const r = await license.redeemActivationKey(licenseServerUrl(), machineId, String(key || "").trim(), String(label ?? ""));
    if (r.token) { clearRevoked(); license.writeActivation(userDataDir, r.token); }
    return { ...license.getEntitlement(userDataDir, machineId), machineId, error: r.error };
  });
}

function registerUpdaterIpc(log: (m: string) => void): void {
  ipcMain.handle("update-check", async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
      const res = await autoUpdater.checkForUpdates();
      return { ok: true, version: res?.updateInfo?.version ?? null };
    } catch (e) {
      log(`[updater] check failed: ${e}`);
      return { ok: false, error: String(e) };
    }
  });
  ipcMain.handle("update-download", async (e) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
      autoUpdater.on("download-progress", (p: { percent?: number }) => {
        try { e.sender.send("update-progress", Math.round(p.percent ?? 0)); } catch { /* window gone */ }
      });
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      log(`[updater] download failed: ${err}`);
      return { ok: false, error: String(err) };
    }
  });
  ipcMain.handle("update-install", () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
}

const isDev = !app.isPackaged;
const standaloneDir = isDev ? join(__dirname, "..", ".next", "standalone") : join(process.resourcesPath, "app", ".next", "standalone");
const serverEntry = join(standaloneDir, "server.js");
const ddlPath = join(standaloneDir, "prisma", "sqlite-init.sql");
const generatedClient = join(standaloneDir, "src", "generated", "prisma-sqlite");
// Pre-seeded DB bundled with the Local build (schema + base data: admin,
// settings, units/tiers/types, wilayas, main depot). Copied on first run.
const seedDbPath = isDev
  ? join(__dirname, "..", "prisma", "sqlite-seed.db")
  : join(standaloneDir, "prisma", "sqlite-seed.db");

let mainWindow: BrowserWindow | null = null;
let serverPort = 0;
/// Never-closed lifecycle: quit only from the tray.
let quitting = false;
let tray: Tray | null = null;
/// Supervised backend: restarted automatically on crash.
type ServerChild = { kill(): void; once(event: string, cb: (...args: never[]) => void): void };
let serverChild: ServerChild | null = null;
let crashCount = 0;

function trayIcon(): Electron.NativeImage {
  try {
    const img = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_B64}`);
    return img.isEmpty() ? nativeImage.createEmpty() : img;
  } catch {
    return nativeImage.createEmpty();
  }
}

function setupTray(log: (m: string) => void): void {
  if (tray) return;
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip("Distribuili — server running");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "فتح Distribuili",
          click: () => {
            mainWindow?.show();
            mainWindow?.focus();
          },
        },
        {
          label: "إعادة تشغيل السيرفر",
          click: () => {
            void reviveServer(log);
          },
        },
        { type: "separator" },
        {
          label: "خروج",
          click: () => {
            quitting = true;
            try {
              serverChild?.kill();
            } catch {
              /* ignore */
            }
            app.quit();
          },
        },
      ])
    );
    tray.on("click", () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
    log("[tray] ready");
  } catch (e) {
    log(`[tray] unavailable: ${String(e)}`);
  }
}

/// Restart the backend after a crash (same port when still free), then
/// reload the window onto it. Retries forever with backoff — the server
/// never stays down while the app lives.
async function reviveServer(log: (m: string) => void): Promise<void> {
  if (quitting || appMode !== "local") return;
  try {
    serverPort = await startServer(log);
    crashCount = 0;
    log(`[server] revived on :${serverPort}`);
    routeByEntitlement();
  } catch (e) {
    crashCount += 1;
    const wait = Math.min(60000, 3000 * crashCount);
    log(`[server] revive failed: ${String(e)} — retry in ${wait}ms`);
    setTimeout(() => void reviveServer(log), wait);
  }
}

function watchServer(child: ServerChild, log: (m: string) => void): void {
  serverChild = child;
  child.once("exit", (code: unknown) => {
    serverChild = null;
    if (quitting || appMode !== "local") return;
    crashCount += 1;
    const wait = Math.min(60000, 3000 * crashCount);
    log(`[server] exited (${String(code)}) — restart in ${wait}ms`);
    setTimeout(() => void reviveServer(log), wait);
  });
}

async function freePort(start = 32517): Promise<number> {
  for (let port = start; port < start + 200; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(port, "127.0.0.1");
    });
    if (ok) return port;
  }
  throw new Error("No free port");
}

function serverPortFile(): string {
  return join(userDataDir, "server-port.txt");
}

async function portFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "0.0.0.0");
  });
}

/// Same port on every boot (phones keep their saved address). Stored in
/// userData; re-probed each launch in case something else took it.
async function stablePort(log: (m: string) => void): Promise<number> {
  try {
    const raw = readFileSync(serverPortFile(), "utf8").trim();
    const saved = Number(raw);
    if (Number.isInteger(saved) && saved >= 1024 && saved <= 65535 && (await portFree(saved))) {
      log(`[server] reusing stable port :${saved}`);
      return saved;
    }
  } catch {
    /* no saved port yet */
  }
  const port = await freePort();
  try {
    writeFileSync(serverPortFile(), String(port), "utf8");
  } catch {
    /* best-effort */
  }
  return port;
}

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 4000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitReady(port: number, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Local server did not become ready");
}

function dbFile(): string {
  return join(app.getPath("userData"), "distribuili.db");
}
function dbUrl(): string {
  return `file:${dbFile().replace(/\\/g, "/")}`;
}

// First-run: copy the bundled pre-seeded DB; fall back to empty schema from
// DDL when no seed bundle is present. Then migrate existing installs forward
// from the shipped DDL (additive + idempotent, never blocks startup).
async function bootstrapIfNeeded(log: (m: string) => void): Promise<void> {
  if (existsSync(dbFile())) return;
  if (existsSync(seedDbPath)) {
    copyFileSync(seedDbPath, dbFile());
    log("[db] initialized from bundled seed");
    return;
  }
  if (!existsSync(ddlPath)) {
    throw new Error(`Missing SQLite DDL at ${ddlPath} (run electron:prepare).`);
  }
  log("[db] no seed bundle — creating empty schema from DDL");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("libsql");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = new Database(dbFile(), {});
  try { db.exec(readFileSync(ddlPath, "utf8")); }
  finally { try { db.close(); } catch { /* noop */ } }
}

function migrateSchemaIfNeeded(log: (m: string) => void): void {
  if (!existsSync(dbFile()) || !existsSync(ddlPath)) return;
  try {
    const res = migrateSqliteSchema(dbFile(), readFileSync(ddlPath, "utf8"), log);
    const n = res.addedTables.length + res.addedColumns.length + res.addedIndexes.length;
    log(n > 0 ? `[db-migrate] applied ${n} schema change(s)` : "[db-migrate] schema up to date");
  } catch (e) {
    log(`[db-migrate] FAILED (${e}) — continuing with unmigrated schema`);
  }
}

async function startServer(log: (m: string) => void): Promise<number> {
  await bootstrapIfNeeded(log);
  migrateSchemaIfNeeded(log);
  const url = dbUrl();
  // Stable port: persisted per machine so the phones' saved address keeps
  // working across reboots (falls back to a fresh free port if taken).
  const port = await stablePort(log);
  const { utilityProcess } = await import("electron");
  const child = utilityProcess.fork(serverEntry, [], {
    cwd: standaloneDir,
    serviceName: "distribuili-server",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DISTRIBUILI_DB: "local",
      DISTRIBUILI_SQLITE_URL: url,
      DISTRIBUILI_SQLITE_CLIENT: generatedClient,
      DISTRIBUILI_USERDATA: userDataDir,
      DISTRIBUILI_MACHINE_ID: machineId,
      JWT_SECRET: process.env.JWT_SECRET || localJwtSecret(),
      PORT: String(port),
      // LAN-reachable: the office PC IS the server (phones connect to it).
      // Windows Firewall will ask once — allow private networks.
      HOSTNAME: "0.0.0.0",
      // Same public key the main process verifies with → the bundled Next
      // server enforces the identical gate (direct-Chrome bypass closed).
      DISTRIBUILI_LICENSE_PUBLIC_KEY: license.publicKeyB64(),
    },
  });
  void child;
  watchServer(child, log);
  await waitReady(port);
  try {
    const nets = (await import("node:os")).networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const n of list ?? []) {
        if (n.family === "IPv4" && !n.internal) log(`[lan] phone URL → http://${n.address}:${port}`);
      }
    }
  } catch {
    /* ignore */
  }
  return port;
}

// Per-machine JWT secret for the local server (stable across launches so
// sessions survive restarts).
function localJwtSecret(): string {
  const f = join(userDataDir, "jwt.secret");
  try {
    if (existsSync(f)) {
      const s = readFileSync(f, "utf8").trim();
      if (s) return s;
    }
    const s = crypto.randomBytes(48).toString("hex");
    writeFileSync(f, s, "utf8");
    return s;
  } catch {
    return crypto.randomBytes(48).toString("hex");
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  // Close → hide to tray (server keeps running). Real quit only from tray.
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { hostname } = new URL(url);
      const srvHost = (() => {
        try {
          return new URL(effServerUrl()).hostname;
        } catch {
          return "";
        }
      })();
      if (hostname === "127.0.0.1" || hostname === "localhost" || (srvHost && hostname === srvHost)) {
        mainWindow?.loadURL(url);
        return { action: "deny" };
      }
    } catch {
      /* external */
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  // Unreachable server → setup page (client enters THEIR address).
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, validatedURL) => {
    if (appMode === "server" && validatedURL && !validatedURL.startsWith("file:")) {
      showServerSetup(`${desc || code}`);
    }
  });
}

// One instance only: a second launch (e.g. autostart racing a click)
// focuses the running window instead of starting a second server.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

app.whenReady().then(async () => {
  userDataDir = app.getPath("userData");
  machineId = getStableMachineId();
  ({ mode: appMode, serverUrl } = readBuildMode());
  const log = (m: string) => {
    try { process.stdout.write(`${new Date().toISOString()} ${m}\n`); } catch { /* stdout closed */ }
  };
  log(`[updater] ${configureUpdater(log, userDataDir)}`);
  registerLicenseIpc();
  registerUpdaterIpc(log);
  registerServerUrlIpc();
  Menu.setApplicationMenu(null);
  // Start with Windows (survives reboots): the app relaunches on login and
  // the supervised server comes back with it. No admin rights needed.
  try {
    app.setLoginItemSettings({ openAtLogin: true });
    log("[boot] openAtLogin enabled — server survives reboots");
  } catch (e) {
    log(`[boot] openAtLogin failed: ${String(e)}`);
  }
  setupTray(log);
  createWindow();

  // Server thin-client: straight to the (client-set) domain, setup page
  // when unreachable, no local backend/license gate.
  if (appMode === "server") {
    if (!readServerUrlOverride()) {
      log("[boot] server mode — no address set yet → setup");
      showServerSetup("");
      return;
    }
    const target = effServerUrl();
    log(`[boot] server mode → ${target}`);
    mainWindow?.loadURL(`${target}/ar/dashboard`).catch(() => showServerSetup(""));
    return;
  }

  mainWindow?.loadURL(`data:text/html,<h2 style="font-family:system-ui">Distribuili…</h2>`);
  try {
    serverPort = await startServer(log);
    routeByEntitlement();
    // First boot on this PC: offer the always-on setup (UAC + password).
    setTimeout(() => offerAlwaysOn(log), 4000);
    // Live activation pickup + revocation enforcement (fail-open, online only).
    setInterval(async () => {
      try {
        const res = await license.pullActivation(licenseServerUrl(), machineId);
        if (res.revoked) {
          enforceLock(log);
          return;
        }
        if (res.trialEnded) {
          license.clearTrial(userDataDir);
          routeByEntitlement();
          return;
        }
        if (res.token) {
          clearLockFlag();
          if (!license.getEntitlement(userDataDir, machineId).activated) {
            license.writeActivation(userDataDir, res.token);
            routeByEntitlement();
          }
        }
      } catch { /* offline — stay on cached entitlement */ }
    }, 30000);
  } catch (e) {
    await mainWindow?.loadURL(`data:text/html,<pre>${String(e)}</pre>`);
  }
});

app.on("before-quit", () => {
  quitting = true;
  try {
    serverChild?.kill();
  } catch {
    /* ignore */
  }
});

app.on("window-all-closed", () => {
  // Never quit implicitly: the server must outlive the window (tray owns it).
  if (process.platform === "darwin" && quitting) app.quit();
});
