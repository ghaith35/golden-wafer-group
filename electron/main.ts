import { app, BrowserWindow, Menu, nativeImage, shell, ipcMain, Tray, dialog, session, screen } from "electron";
import { TRAY_ICON_B64 } from "./tray-icon";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, copyFileSync, appendFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import * as license from "./license";
import { configureUpdater } from "./updater";
import { loadSqliteDatabase, migrateSqliteSchema } from "./sqlite-migrate";
import type { BundleEntryPoints } from "./bundle-update";
import {
  activateBundle,
  checkBundleUpdate,
  downloadBundle,
  entryPointsForDir,
  isDownloaded,
  pruneBundles,
  readActiveBundle,
  resolveFeedUrl,
  versionDir,
  type BundleManifest,
} from "./bundle-update";

// Central license server (holds the private key). Default: the company's
// own Distribuili server. Override per-install via <userData>/license-server.json
// { "url": "https://..." } or the DISTRIBUILI_LICENSE_URL env var.
const DEFAULT_LICENSE_URL = "https://distribuili.khiatadz.com";

// The build mode is baked into each installer via build-mode.json
// (set by scripts/set-mode.mjs before packaging):
//   local  → offline SQLite desktop (full standalone server + license gate)
//   server → thin client to the cloud/SaaS domain (no local server, no gate)
// bundleUpdates: "auto" (connected flavors check+apply silently at boot) or
// "manual" (offline flavors: zero update traffic, Settings → Update only).
function readBuildMode(): { mode: "local" | "server"; serverUrl: string; bundleUpdates: "auto" | "manual" } {
  const p = app.isPackaged
    ? join(process.resourcesPath, "build-mode.json")
    : join(__dirname, "..", "..", "build-mode.json");
  try {
    const c = JSON.parse(readFileSync(p, "utf8")) as { mode?: string; serverUrl?: string; bundleUpdates?: string };
    return {
      mode: c.mode === "server" ? "server" : "local",
      serverUrl: c.serverUrl || "https://votre-domaine.com",
      bundleUpdates: c.bundleUpdates === "auto" ? "auto" : "manual",
    };
  } catch {
    return { mode: "local", serverUrl: "https://votre-domaine.com", bundleUpdates: "manual" };
  }
}

let appMode: "local" | "server" = "local";
let bundleUpdates: "auto" | "manual" = "manual";
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
<title>Golden Wafer — Server</title>
<style>body{font-family:system-ui;background:#070708;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#121214;border-radius:16px;padding:28px;max-width:420px;width:92%;box-shadow:0 10px 40px #0008}
h1{font-size:18px;margin:0 0 6px}p{font-size:13px;opacity:.7;margin:0 0 14px}
input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a2416;background:#070708;color:#fff;font-size:14px;direction:ltr}
button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;background:#c9951a;color:#1c1200;font-size:15px;font-weight:800;cursor:pointer}
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

// ── Facture PDF handoff to the OS ─────────────────────────────────────────
// The renderer cannot reach other apps from inside the sandbox, so the
// desktop shell does it: "open" writes the PDF to temp and launches the
// OS default viewer (print / share / WhatsApp-desktop from there — the
// desktop equivalent of the phone's share sheet); "save" shows the native
// save dialog. Old shells lack these channels — the renderer detects that
// and falls back to download, never throwing.
function cleanPdfName(v: unknown): string {
  const s = String(v || "facture.pdf").replace(/[^\w.\-()\[\\] ]+/g, "_").slice(0, 80) || "facture.pdf";
  return s.toLowerCase().endsWith(".pdf") ? s : `${s}.pdf`;
}

function registerPdfIpc(): void {
  ipcMain.handle("pdf-open", async (_e, args: { fileName?: unknown; base64?: unknown }) => {
    try {
      const b64 = String(args?.base64 || "");
      if (!b64) return { ok: false, error: "empty" };
      const { tmpdir } = require("node:os") as typeof import("node:os");
      const dir = join(tmpdir(), "distribuili-pdf");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const p = join(dir, `${Date.now()}-${cleanPdfName(args?.fileName)}`);
      writeFileSync(p, Buffer.from(b64, "base64"));
      const err = await shell.openPath(p);
      return err ? { ok: false, error: err } : { ok: true, path: p };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  // Exact-size label printing: the renderer sends one PNG per label plus the
  // paper size in mm. A hidden window lays them out with @page { size } and
  // webContents.print() is given the same pageSize, so the paper follows the
  // size picked in the app instead of the printer driver's default.
  ipcMain.handle(
    "print-labels",
    async (_e, args: { images?: unknown; widthMm?: unknown; heightMm?: unknown }) => {
      try {
        const images = Array.isArray(args?.images) ? (args.images as unknown[]).map(String) : [];
        const w = Math.round(Number(args?.widthMm));
        const h = Math.round(Number(args?.heightMm));
        if (!images.length || !(w >= 20 && w <= 300) || !(h >= 20 && h <= 300)) return { ok: false, error: "bad-args" };
        const { tmpdir } = require("node:os") as typeof import("node:os");
        const dir = join(tmpdir(), "distribuili-labels", String(Date.now()));
        mkdirSync(dir, { recursive: true });
        const tags = images.map((d, i) => {
          const m = /^data:image\/png;base64,(.+)$/.exec(d);
          if (!m) throw new Error("bad-image");
          writeFileSync(join(dir, `p${i}.png`), Buffer.from(m[1], "base64"));
          return `<img src="p${i}.png">`;
        });
        const html =
          `<!doctype html><meta charset="utf-8"><style>` +
          `@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0}` +
          `img{display:block;width:${w}mm;height:${h}mm;page-break-after:always;break-after:page}` +
          `img:last-child{page-break-after:auto;break-after:auto}</style>${tags.join("")}`;
        const file = join(dir, "labels.html");
        writeFileSync(file, html);
        const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
        try {
          await win.loadFile(file);
          return await new Promise<{ ok?: boolean; canceled?: boolean; error?: string }>((resolve) => {
            win.webContents.print(
              {
                silent: false,
                printBackground: true,
                margins: { marginType: "none" },
                pageSize: { width: w * 1000, height: h * 1000 },
              },
              (success, reason) => {
                if (success) resolve({ ok: true });
                else if (/cancel/i.test(reason || "")) resolve({ ok: false, canceled: true });
                else resolve({ ok: false, error: reason || "print-failed" });
              }
            );
          });
        } finally {
          win.destroy();
        }
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }
  );
  ipcMain.handle("pdf-save", async (_e, args: { fileName?: unknown; base64?: unknown }) => {
    try {
      const b64 = String(args?.base64 || "");
      if (!b64) return { ok: false, error: "empty" };
      const res = await dialog.showSaveDialog({
        defaultPath: cleanPdfName(args?.fileName),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      writeFileSync(res.filePath, Buffer.from(b64, "base64"));
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: String(e) };
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
      title: "Golden Wafer Group",
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

/// Desktop activation was removed: always entitled (set true to enforce licenses again;
/// keep in sync with LICENSE_ENFORCED in src/lib/license/gate.ts).
const LICENSE_ENFORCED = false;

function entitled(): boolean {
  if (!LICENSE_ENFORCED) return true;
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
  if (!LICENSE_ENFORCED) return; // activation removed: a server revoke never locks the install
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
  void mainWindow.loadURL(entitled() ? `${url}/ar/dashboard` : `${url}/ar/activate`).catch(() => {});
}

/// PC name/specs for the vendor console (repaire parity): hostname, platform,
/// CPU, RAM, disk, app version. Best-effort, explicit flows only (register /
/// trial / redeem) — never background polling.
function collectDeviceSpecs(): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("node:os") as typeof import("node:os");
    const host = String(os.hostname() || "").slice(0, 120);
    if (host) out.pcName = host;
    out.platform = `${os.platform()} ${os.release()}`.slice(0, 120);
    out.arch = String(os.arch()).slice(0, 32);
    const cpus = os.cpus() || [];
    if (cpus.length > 0) {
      out.cpu = String(cpus[0].model || "").slice(0, 160);
      out.cores = cpus.length;
      if (cpus[0].speed > 0) out.cpuSpeedMHz = cpus[0].speed;
    }
    const gb = os.totalmem() / 1073741824;
    if (Number.isFinite(gb) && gb > 0) out.ramGB = Math.round(gb * 10) / 10;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
      if (os.platform() === "win32") {
        const raw = execFileSync("wmic", ["logicaldisk", "where", "DeviceID='C:'", "get", "Size,FreeSpace", "/format:value"], { encoding: "utf8", timeout: 8000 });
        const size = Number(/Size=(\d+)/.exec(raw)?.[1] ?? 0);
        const free = Number(/FreeSpace=(\d+)/.exec(raw)?.[1] ?? 0);
        if (size > 0) out.diskTotalGB = Math.round((size / 1073741824) * 10) / 10;
        if (free > 0) out.diskFreeGB = Math.round((free / 1073741824) * 10) / 10;
      } else {
        const raw = execFileSync("df", ["-k", "/"], { encoding: "utf8", timeout: 8000 });
        const parts = raw.trim().split("\n").pop()?.trim().split(/\s+/) ?? [];
        const totalKb = Number(parts[1] ?? 0);
        const freeKb = Number(parts[3] ?? 0);
        if (totalKb > 0) out.diskTotalGB = Math.round(((totalKb * 1024) / 1073741824) * 10) / 10;
        if (freeKb > 0) out.diskFreeGB = Math.round(((freeKb * 1024) / 1073741824) * 10) / 10;
      }
    } catch {
      /* disk probe best-effort */
    }
    out.appVersion = app.getVersion();
  } catch {
    /* best-effort — never break licensing on specs */
  }
  return out;
}

function registerLicenseIpc(): void {
  ipcMain.handle("license-status", () => {
    const e = license.getEntitlement(userDataDir, machineId);
    if (readLockFlag()) return { ...e, activated: false, inTrial: false, locked: true, machineId };
    if (isRevoked()) return { ...e, activated: false, inTrial: false, machineId };
    return { ...e, machineId, serverUrl: licenseServerUrl() };
  });
  ipcMain.handle("license-register", async (_e, label?: string, phone?: string, info?: license.MachineInfo) => {
    await license.registerMachine(licenseServerUrl(), machineId, String(label ?? ""), phone?.trim() || undefined, collectDeviceSpecs(), info);
    return { ...license.getEntitlement(userDataDir, machineId), machineId };
  });
  ipcMain.handle("license-start-trial", async (_e, info: license.TrialInfo) => {
    const r = await license.requestTrial(licenseServerUrl(), machineId, { ...(info || {}), specs: collectDeviceSpecs() });
    if (r.token) { clearLockFlag(); license.writeTrial(userDataDir, r.token); }
    if (r.activated) {
      const t = await license.issueActivation(licenseServerUrl(), machineId);
      if (t) { clearLockFlag(); license.writeActivation(userDataDir, t); }
    }
    return { ...license.getEntitlement(userDataDir, machineId), machineId, error: r.error, revoked: r.revoked };
  });
  ipcMain.handle("license-check", async () => {
    const t = await license.issueActivation(licenseServerUrl(), machineId);
    if (t) { clearLockFlag(); license.writeActivation(userDataDir, t); }
    return { ...license.getEntitlement(userDataDir, machineId), machineId };
  });
  ipcMain.handle("license-enter-key", (_e, token: string) => {
    const tok = String(token || "").trim();
    if (license.verifyActivationToken(tok, machineId)) { clearLockFlag(); license.writeActivation(userDataDir, tok); }
    else if (license.verifyTrialToken(tok, machineId)) { clearLockFlag(); license.writeTrial(userDataDir, tok); }
    return { ...license.getEntitlement(userDataDir, machineId), machineId };
  });
  ipcMain.handle("license-redeem-key", async (_e, key: string, label?: string, info?: license.MachineInfo) => {
    const r = await license.redeemActivationKey(licenseServerUrl(), machineId, String(key || "").trim(), String(label ?? ""), collectDeviceSpecs(), info);
    if (r.token) { clearLockFlag(); license.writeActivation(userDataDir, r.token); }
    return { ...license.getEntitlement(userDataDir, machineId), machineId, error: r.error };
  });
}

function registerUpdaterIpc(log: (m: string) => void): void {
  ipcMain.handle("update-check", async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
      const res = await autoUpdater.checkForUpdates();
      const notes = res?.updateInfo?.releaseNotes;
      return {
        ok: true,
        currentVersion: app.getVersion(),
        version: res?.updateInfo?.version ?? null,
        releaseNotes: typeof notes === "string" ? notes : Array.isArray(notes) ? notes.map((n) => n.note ?? "").join("\n") : null,
      };
    } catch (e) {
      const msg = String(e);
      log(`[updater] check failed: ${msg}`);
      // The feed was never published (or the flavor path is wrong): say so
      // instead of dumping electron-updater's auth-token/404 HTML soup.
      const friendly = /404|ERR_FILE_NOT_FOUND|net::ERR/i.test(msg) ? "feed_missing" : msg;
      return { ok: false, currentVersion: app.getVersion(), error: friendly };
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

// ── Web-bundle updates (no reinstall) ────────────────────────────────────
// Same updates tree as the installer feed; the manifest is bundle.json next
// to latest.yml. Shell-level changes still need a full installer + version
// bump — bundles carry UI/API/logic only.
const BAKED_BUNDLE_FEED = "https://distribuili.khiatadz.com/updates/local/bundle.json";

/// True while a bundle swap owns the server child (supervisor stands down).
let swappingBundle = false;
/// Version of the bundle currently serving traffic (null = baked fallback).
let runningBundleVersion: string | null = null;
let bundleFeedUrl = BAKED_BUNDLE_FEED;
let lastBundleManifest: BundleManifest | null = null;
let bundleBusy = false;

function applyingPageHtml(version: string): string {
  return startupPageHtml(
    "جاري تطبيق التحديث",
    "يتم التبديل إلى النسخة الجديدة، يرجى الانتظار قليلاً.",
    "Applying update",
    `Switching to version ${version}…`
  );
}

/// Swap traffic to a downloaded bundle version: loading screen → kill server
/// (supervisor paused) → boot new dir → health probe → activate + prune.
/// On ANY failure the old bundle is restored and rebooted — the app never
/// strands the user without a server.
async function applyBundleVersion(version: string, log: (m: string) => void): Promise<void> {
  if (appMode !== "local") throw new Error("bundle_apply only serves local-mode installs");
  const dir = versionDir(userDataDir, version);
  const next = entryPointsForDir(dir);
  const prev = activeEntry;
  const prevVersion = runningBundleVersion;
  log(`[bundle] applying ${version} …`);
  swappingBundle = true;
  try {
    try {
      await mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(applyingPageHtml(version))}`);
    } catch {
      /* window may be closed — tray keeps us alive */
    }
    try {
      serverChild?.kill();
    } catch {
      /* already dead */
    }
    serverChild = null;
    activeEntry = next;
    try {
      serverPort = await startServer(log);
    } catch (e) {
      // New bundle failed to boot — roll back to the previous one. If the
      // rollback itself fails, hand the child back to the supervisor loop.
      log(`[bundle] ${version} failed to boot (${e}) — rolling back`);
      activeEntry = prev;
      try {
        serverPort = await startServer(log);
      } catch (e2) {
        log(`[bundle] rollback boot failed (${e2}) — supervisor will retry`);
        setTimeout(() => void reviveServer(log), 5000);
        throw new Error(`apply_failed_rolled_back: ${String(e)} / rollback: ${String(e2)}`);
      }
      // Rollback is live again — steer the window off the applying page
      // (otherwise the user stares at "Switching…" forever with a healthy
      // server behind it) and report the failure to the caller.
      routeByEntitlement();
      throw new Error(`apply_failed_rolled_back: ${String(e)}`);
    }
    activateBundle(userDataDir, version);
    runningBundleVersion = version;
    pruneBundles(userDataDir, version, 2, log);
    routeByEntitlement();
    log(`[bundle] ${version} live (was ${prevVersion ?? "baked"})`);
  } finally {
    swappingBundle = false;
  }
}

function registerBundleIpc(log: (m: string) => void): void {
  const guard = () => {
    if (appMode !== "local") return { ok: false, error: "local_mode_only" } as const;
    return null;
  };
  ipcMain.handle("bundle-status", () => ({
    ok: true,
    shellVersion: app.getVersion(),
    runningVersion: runningBundleVersion,
    busy: bundleBusy,
    manifest: lastBundleManifest,
    auto: bundleUpdates === "auto",
    feed: (() => {
      try {
        return new URL(bundleFeedUrl).host;
      } catch {
        return bundleFeedUrl;
      }
    })(),
  }));
  ipcMain.handle("bundle-check", async () => {
    const g = guard();
    if (g) return { ...g, currentVersion: app.getVersion() };
    try {
      const { manifest, newer } = await checkBundleUpdate(userDataDir, bundleFeedUrl);
      lastBundleManifest = manifest;
      return {
        ok: true,
        currentVersion: app.getVersion(),
        runningVersion: runningBundleVersion,
        version: manifest.version,
        newer,
        downloaded: isDownloaded(userDataDir, manifest),
      };
    } catch (e) {
      log(`[bundle] check failed: ${e}`);
      return { ok: false, currentVersion: app.getVersion(), error: String(e) };
    }
  });
  ipcMain.handle("bundle-download", async (e) => {
    const g = guard();
    if (g) return g;
    if (!lastBundleManifest) return { ok: false, error: "check_first" };
    if (bundleBusy) return { ok: false, error: "busy" };
    bundleBusy = true;
    try {
      await downloadBundle(userDataDir, lastBundleManifest, (pct) => {
        try {
          e.sender.send("bundle-progress", pct);
        } catch {
          /* window gone */
        }
      }, log);
      return { ok: true, version: lastBundleManifest.version };
    } catch (err) {
      log(`[bundle] download failed: ${err}`);
      return { ok: false, error: String(err) };
    } finally {
      bundleBusy = false;
    }
  });
  ipcMain.handle("bundle-apply", async () => {
    const g = guard();
    if (g) return g;
    if (!lastBundleManifest) return { ok: false, error: "check_first" };
    if (bundleBusy) return { ok: false, error: "busy" };
    if (runningBundleVersion === lastBundleManifest.version) return { ok: true, noop: true };
    bundleBusy = true;
    try {
      await applyBundleVersion(lastBundleManifest.version, log);
      return { ok: true, version: lastBundleManifest.version };
    } catch (err) {
      log(`[bundle] apply failed: ${err}`);
      return { ok: false, error: String(err) };
    } finally {
      bundleBusy = false;
    }
  });
}

/// Boot-time automatic track: check → download → apply, all best-effort.
/// Never blocks boot, never throws — failures only log.
async function maybeAutoBundleUpdate(log: (m: string) => void): Promise<void> {
  if (appMode !== "local" || bundleUpdates !== "auto") return;
  try {
    const { manifest, newer } = await checkBundleUpdate(userDataDir, bundleFeedUrl);
    if (!newer) {
      log(`[bundle] auto: up to date (${manifest.version} ≤ shell)`);
      return;
    }
    if (runningBundleVersion === manifest.version) {
      log(`[bundle] auto: ${manifest.version} already running`);
      return;
    }
    lastBundleManifest = manifest;
    await downloadBundle(userDataDir, manifest, () => {}, log);
    await applyBundleVersion(manifest.version, log);
  } catch (e) {
    log(`[bundle] auto update skipped: ${e}`);
  }
}

const isDev = !app.isPackaged;
// Baked fallback bundle (ships inside the installer). A newer downloaded web
// bundle under <userData>/web-bundles/<version>/ takes precedence at boot.
function bakedStandaloneDir(): string {
  return isDev ? join(__dirname, "..", ".next", "standalone") : join(process.resourcesPath, "app", ".next", "standalone");
}

/// Currently-served web bundle. Re-pointed (never mutated) on bundle apply.
let activeEntry: BundleEntryPoints = entryPointsForDir(bakedStandaloneDir());

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
    tray.setToolTip("Golden Wafer — server running");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "فتح Golden Wafer",
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
        {
          label: "فتح مجلد السجلات",
          click: () => {
            try {
              shell.openPath(join(userDataDir, "logs"));
            } catch {
              /* ignore */
            }
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
    // A deliberate kill during a bundle swap is handled by the swap flow —
    // the supervisor must not resurrect the old bundle mid-apply.
    if (swappingBundle) return;
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
  // Encode spaces / # / ? so Windows profile paths (e.g. "C:\Users\John Doe"
  // or non-ASCII/Arabic usernames) don't break the libSQL URL parser.
  const p = dbFile().replace(/\\/g, "/");
  return `file:${encodeURI(p).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
}

// First-run: copy the bundled pre-seeded DB; fall back to empty schema from
// DDL when no seed bundle is present. Then migrate existing installs forward
// from the shipped DDL (additive + idempotent, never blocks startup).
async function bootstrapIfNeeded(log: (m: string) => void): Promise<void> {
  if (existsSync(dbFile())) return;
  const seedCandidates = [activeEntry.seedDbPath];
  if (isDev) seedCandidates.push(join(__dirname, "..", "prisma", "sqlite-seed.db"));
  const seed = seedCandidates.find((p) => existsSync(p));
  if (seed) {
    copyFileSync(seed, dbFile());
    log("[db] initialized from bundled seed");
    return;
  }
  const ddlPath = activeEntry.ddlPath;
  if (!existsSync(ddlPath)) {
    throw new Error(`Missing SQLite DDL at ${ddlPath} (run electron:prepare).`);
  }
  log("[db] no seed bundle — creating empty schema from DDL");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = loadSqliteDatabase(activeEntry.standaloneDir);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = new Database(dbFile(), {});
  try { db.exec(readFileSync(ddlPath, "utf8")); }
  finally { try { db.close(); } catch { /* noop */ } }
}

function migrateSchemaIfNeeded(log: (m: string) => void): void {
  const ddlPath = activeEntry.ddlPath;
  if (!existsSync(dbFile()) || !existsSync(ddlPath)) return;
  try {
    const res = migrateSqliteSchema(dbFile(), readFileSync(ddlPath, "utf8"), log, activeEntry.standaloneDir);
    const n = res.addedTables.length + res.addedColumns.length + res.addedIndexes.length;
    if (res.skipped.length) throw new Error(`SQLite schema upgrade incomplete: ${res.skipped.join("; ")}`);
    log(n > 0 ? `[db-migrate] applied ${n} schema change(s)` : "[db-migrate] schema up to date");
  } catch (e) {
    log(`[db-migrate] FAILED (${e})`);
    throw e;
  }
}

// ── Per-client installer identity (baked at build time) ─────────────────
// scripts/set-client.mjs writes build-client.json {client, domain, tunnelToken}
// (gitignored — the token is secret). Staged to build/stage/ and packaged as
// resources/client/. Priority for the link domain:
//   public-hostname.txt (operator override) > env > baked client > default.
// Tunnel token priority (rotation without rebuild):
//   <userData>/tunnel-token.txt > env CLOUDFLARE_TUNNEL_TOKEN > baked token.
const DEFAULT_PUBLIC_HOSTNAME = "https://dist-client1.khiatadz.com";

type BuildClient = { client: string | null; domain: string | null; tunnelToken: string | null };

function readBuildClient(): BuildClient {
  const empty: BuildClient = { client: null, domain: null, tunnelToken: null };
  try {
    const p = app.isPackaged
      ? join(process.resourcesPath, "client", "build-client.json")
      : join(__dirname, "..", "build", "stage", "build-client.json");
    if (!existsSync(p)) return empty;
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<BuildClient>;
    return {
      client: typeof raw.client === "string" ? raw.client : null,
      domain: typeof raw.domain === "string" ? raw.domain : null,
      tunnelToken: typeof raw.tunnelToken === "string" && raw.tunnelToken ? raw.tunnelToken : null,
    };
  } catch {
    return empty;
  }
}

function publicHostnameFile(): string {
  return join(userDataDir, "public-hostname.txt");
}

function readPublicHostname(baked: BuildClient): string {
  try {
    const raw = readFileSync(publicHostnameFile(), "utf8").trim().replace(/\/+$/, "");
    if (raw) {
      const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      if (/^https:\/\/[^/]+\.[^/]+$/i.test(withProto)) return withProto;
    }
  } catch {
    /* no override file */
  }
  const env = (process.env.DISTRIBUILI_PUBLIC_HOSTNAME || "").trim();
  if (env) {
    const withProto = /^https?:\/\//i.test(env) ? env : `https://${env}`;
    if (/^https:\/\/[^/]+\.[^/]+$/i.test(withProto)) return withProto;
  }
  if (baked.domain && /^https:\/\/[^/]+\.[^/]+$/i.test(baked.domain.replace(/\/+$/, ""))) {
    return baked.domain.replace(/\/+$/, "");
  }
  return DEFAULT_PUBLIC_HOSTNAME;
}

function readTunnelToken(baked: BuildClient): string {
  try {
    const raw = readFileSync(join(userDataDir, "tunnel-token.txt"), "utf8").trim();
    if (raw) return raw;
  } catch {
    /* no override file */
  }
  const env = (process.env.CLOUDFLARE_TUNNEL_TOKEN || "").trim();
  if (env) return env;
  return baked.tunnelToken || "";
}

// ── Bundled cloudflared supervisor ──────────────────────────────────────
// The installer ships the connector (resources/client/bin/). When a tunnel
// token is configured, the app exposes itself at its subdomain automatically:
// phones reach it over the internet AND over LAN (server binds 0.0.0.0).
// Dashboard ingress for the hostname must point at the stable local port.
let tunnelChild: import("node:child_process").ChildProcess | null = null;
let tunnelCrashCount = 0;
let tunnelReady = false;

function connectorBinary(): string {
  const exe = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const packaged = join(process.resourcesPath, "client", "bin", exe);
  if (existsSync(packaged)) return packaged;
  const staged = join(__dirname, "..", "build", "stage", "bin", exe);
  if (existsSync(staged)) return staged;
  const plat = process.platform === "win32" ? "win-x64" : process.arch === "arm64" ? "darwin-arm64" : "darwin-amd64";
  const cached = join(__dirname, "..", "build", "bin", plat, exe);
  return cached;
}

function startTunnel(token: string, log: (m: string) => void): void {
  if (tunnelChild || quitting || appMode !== "local") return;
  const bin = connectorBinary();
  if (!existsSync(bin)) {
    log("[tunnel] no bundled connector — LAN-only (phones via WiFi IP)");
    return;
  }
  if (process.platform !== "win32") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").chmodSync(bin, 0o755);
    } catch {
      /* best-effort */
    }
  }
  log("[tunnel] starting connector…");
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const child = spawn(bin, ["--no-autoupdate", "tunnel", "run", "--token", token], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    tunnelChild = child;
    const onLine = (chunk: Buffer, err: boolean) => {
      for (const line of String(chunk).split("\n")) {
        const t = line.trim();
        if (!t) continue;
        if (/registered tunnel connection/i.test(t) && !tunnelReady) {
          tunnelReady = true;
          log("[tunnel] internet link UP — phones can connect via the domain");
        }
        log(`[tunnel] ${t.slice(0, 300)}`);
        void err;
      }
    };
    child.stdout?.on("data", (c: Buffer) => onLine(c, false));
    child.stderr?.on("data", (c: Buffer) => onLine(c, true));
    child.on("exit", (code) => {
      tunnelChild = null;
      if (quitting) return;
      tunnelCrashCount += 1;
      const wait = Math.min(60000, 3000 * tunnelCrashCount);
      log(`[tunnel] exited (${String(code)}) — restart in ${wait}ms`);
      setTimeout(() => {
        tunnelChild = null;
        startTunnel(token, log);
      }, wait);
    });
  } catch (e) {
    log(`[tunnel] launch failed: ${String(e)} — LAN-only`);
  }
}

function stopTunnel(): void {
  try {
    tunnelChild?.kill();
  } catch {
    /* ignore */
  }
  tunnelChild = null;
}

async function startServer(log: (m: string) => void): Promise<number> {
  await bootstrapIfNeeded(log);
  migrateSchemaIfNeeded(log);
  const url = dbUrl();
  // Stable port: persisted per machine so the phones' saved address keeps
  // working across reboots (falls back to a fresh free port if taken).
  const port = await stablePort(log);
  const baked = readBuildClient();
  const publicHostname = readPublicHostname(baked);
  const tunnelToken = readTunnelToken(baked);
  if (baked.client) log(`[link] client install → ${baked.client} (${publicHostname})`);
  else log(`[link] public hostname → ${publicHostname}`);
  if (!tunnelToken) log("[link] no tunnel token — LAN-only until a token is set (tunnel-token.txt)");
  const { utilityProcess } = await import("electron");
  const child = utilityProcess.fork(activeEntry.serverEntry, [], {
    cwd: activeEntry.standaloneDir,
    serviceName: "distribuili-server",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DISTRIBUILI_DB: "local",
      DISTRIBUILI_SQLITE_URL: url,
      DISTRIBUILI_SQLITE_CLIENT: activeEntry.generatedClient,
      DISTRIBUILI_USERDATA: userDataDir,
      DISTRIBUILI_MACHINE_ID: machineId,
      JWT_SECRET: process.env.JWT_SECRET || localJwtSecret(),
      PORT: String(port),
      ...(publicHostname ? { DISTRIBUILI_PUBLIC_HOSTNAME: publicHostname } : {}),
      // Internet link: the Devices page shows internet ✓ when set.
      ...(tunnelToken ? { DISTRIBUILI_TUNNEL: "1" } : {}),
      // LAN-reachable: the office PC IS the server (phones connect to it).
      // Windows Firewall will ask once — allow private networks.
      HOSTNAME: "0.0.0.0",
      // Same public key the main process verifies with → the bundled Next
      // server enforces the identical gate (direct-Chrome bypass closed).
      DISTRIBUILI_LICENSE_PUBLIC_KEY: license.publicKeyB64(),
      // Explicit dev builds (ALLOW_UNLICENSED_BUILD) have no baked key; unlock
      // them so they're usable. Real builds keep the server gate fail-closed.
      ...(license.isDevBuild() ? { DISTRIBUILI_LICENSE_BYPASS: "1" } : {}),
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
  // Internet connector (phones outside the shop). Dashboard ingress for the
  // hostname must point at this exact port.
  if (tunnelToken) {
    log(`[tunnel] dashboard ingress must be ${publicHostname.replace(/^https:\/\//, "")} → http://127.0.0.1:${port}`);
    startTunnel(tunnelToken, log);
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

function logFilePath(): string {
  try {
    return join(userDataDir, "logs", "main.log");
  } catch {
    return "";
  }
}

/// File-backed logger: stdout is invisible in a packaged app, so every line
/// also appends to <userData>/logs/main.log. When the server never becomes
/// ready ("application is not reachable"), this file is the diagnosis.
function makeLogger(): (m: string) => void {
  let file = "";
  try {
    file = join(userDataDir, "logs", "main.log");
    mkdirSync(join(userDataDir, "logs"), { recursive: true });
    appendFileSync(file, `\n===== ${new Date().toISOString()} app v${app.getVersion()} start =====\n`);
  } catch {
    file = "";
  }
  return (m: string) => {
    const line = `${new Date().toISOString()} ${m}\n`;
    try {
      process.stdout.write(line);
    } catch {
      /* stdout closed */
    }
    if (file) {
      try {
        appendFileSync(file, line);
      } catch {
        /* disk full / locked — stdout already has it */
      }
    }
  };
}

/// Boot-failure page: shows WHAT failed + WHERE the log lives, instead of a
/// bare <pre> or an eternal spinner. The log path is clickable via the tray
/// ("Open logs folder") and via Settings once the server is up.
function bootErrorPageHtml(error: string, logPath: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 4000);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Golden Wafer — تعذر التشغيل</title>
<style>body{font-family:system-ui;background:#070708;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#121214;border-radius:16px;padding:28px;max-width:560px;width:94%;box-shadow:0 10px 40px #0008}
h1{font-size:18px;margin:0 0 8px;color:#f87171}p{font-size:13px;opacity:.85;line-height:1.9}
pre{background:#070708;border:1px solid #2a2416;border-radius:10px;padding:12px;font-size:12px;direction:ltr;text-align:left;white-space:pre-wrap;max-height:220px;overflow:auto}
code{direction:ltr;display:inline-block}</style></head>
<body><div class="card"><h1>⚠️ تعذر تشغيل السيرفر المحلي</h1>
<p>التطبيق يعمل لكن السيرفر الداخلي لم يقلع (لهذا تبدو الصفحة "غير reachable").
الأسباب الشائعة: نسخة خاطئة (ARM64 على PC عادي)، مضاد فيروسات يحجب Node، أو منفذ محجوز.</p>
<pre>${esc(error)}</pre>
<p>سجل التشغيل الكامل:<br><code>${esc(logPath)}</code></p>
<p>أرسل هذا الملف للدعم مع لقطة شاشة. إعادة التشغيل تحاول مجدداً تلقائياً.</p>
</div></body></html>`;
}

function startupPageHtml(
  titleAr = "جاري تشغيل الخادم",
  subAr = "يتم تجهيز مساحة العمل، يرجى الانتظار قليلاً.",
  titleFr = "Démarrage du serveur",
  subFr = "Préparation de votre espace de travail…"
): string {
  return `<!doctype html><html lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Golden Wafer</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#030303;color:#f7f9f5;font-family:-apple-system,BlinkMacSystemFont,"Geeza Pro",sans-serif}
main{width:min(100% - 40px,440px);padding:40px 24px;text-align:center}
.mark{width:84px;height:84px;margin:0 auto 19px;display:block;border-radius:20px}
.brand{margin:0;font:800 15px/1.2 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:1.4px;direction:ltr;color:#e8c14a}
.spinner{width:38px;height:38px;margin:38px auto 20px;border:3px solid rgba(255,255,255,.22);border-top-color:#e8ba4c;border-radius:50%;animation:spin .85s linear infinite}
h1{margin:0;font-size:26px;line-height:1.5;font-weight:800}p{margin:7px 0 0;color:#c3d4c6;font-size:15px;line-height:1.8}
.fr{margin-top:24px;font-size:17px;font-weight:700;color:#fff;direction:ltr}.fr-note{margin-top:3px;font-size:14px}
@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation-duration:2.5s}}
</style></head><body><main role="status" aria-live="polite">
<img class="mark" alt="" src="data:image/png;base64,${TRAY_ICON_B64}"><p class="brand">GOLDEN WAFER GROUP</p>
<div class="spinner" aria-hidden="true"></div>
<h1 dir="rtl">${titleAr}</h1><p dir="rtl">${subAr}</p>
<p class="fr">${titleFr}</p><p class="fr-note" dir="ltr">${subFr}</p>
</main></body></html>`;
}

/// Window geometry persisted between launches: first run opens maximized
/// (like ZZ Sanitaire); afterwards the last size + maximized state is restored,
/// so un-maximizing returns to a sensible, on-screen window.
type WinState = { width: number; height: number; x?: number; y?: number; maximized: boolean };
const winStateFile = () => join(app.getPath("userData"), "window-state.json");
function loadWinState(): WinState {
  try {
    const j = JSON.parse(readFileSync(winStateFile(), "utf8")) as Partial<WinState>;
    const w = Number(j.width), h = Number(j.height);
    if (w >= 900 && h >= 600) {
      const ok = typeof j.x === "number" && typeof j.y === "number" &&
        screen.getAllDisplays().some((d) => {
          const b = d.workArea;
          return j.x! >= b.x - 20 && j.y! >= b.y - 20 && j.x! < b.x + b.width - 100 && j.y! < b.y + b.height - 100;
        });
      return { width: w, height: h, x: ok ? j.x : undefined, y: ok ? j.y : undefined, maximized: j.maximized !== false };
    }
  } catch { /* first run */ }
  return { width: 1366, height: 860, maximized: true };
}
function saveWinState(win: BrowserWindow): void {
  try {
    const maximized = win.isMaximized();
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    writeFileSync(winStateFile(), JSON.stringify({ width: b.width, height: b.height, x: b.x, y: b.y, maximized }));
  } catch { /* best effort */ }
}

function createWindow() {
  const ws = loadWinState();
  mainWindow = new BrowserWindow({
    width: ws.width,
    height: ws.height,
    x: ws.x,
    y: ws.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#070708",
    // Like ZZ Sanitaire: no always-visible menu bar on Windows (Alt reveals it).
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, devTools: true },
  });
  mainWindow.once("ready-to-show", () => {
    if (ws.maximized) mainWindow?.maximize();
    mainWindow?.show();
  });
  let saveTimer: NodeJS.Timeout | undefined;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) saveWinState(mainWindow); }, 400);
  };
  mainWindow.on("resize", scheduleSave);
  mainWindow.on("move", scheduleSave);
  mainWindow.on("maximize", scheduleSave);
  mainWindow.on("unmaximize", scheduleSave);
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (process.platform === "darwin" && input.type === "keyDown" && input.meta && input.alt && input.key.toLowerCase() === "i") {
      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
    }
  });
  mainWindow.on("close", (e) => {
    if (process.platform === "darwin") {
      quitting = true;
      return;
    }
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
  ({ mode: appMode, serverUrl, bundleUpdates } = readBuildMode());
  // Web-bundle feed: baked default, overridable per install
  // (DISTRIBUILI_BUNDLE_URL env or <userData>/bundle-feed.json).
  bundleFeedUrl = resolveFeedUrl(userDataDir, BAKED_BUNDLE_FEED);
  const log = makeLogger();
  // An earlier desktop build registered the phone worker. Remove it before
  // navigating so cached mobile fallbacks cannot hide local server failures.
  await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] });
  log("[boot] cleared desktop service workers and page caches");
  log(`[updater] ${configureUpdater(log, userDataDir)}`);
  log(`[bundle] feed → ${bundleFeedUrl} (mode: ${bundleUpdates})`);
  registerLicenseIpc();
  registerUpdaterIpc(log);
  registerBundleIpc(log);
  registerServerUrlIpc();
  registerPdfIpc();
  // Interface zoom (top-bar − / + and Ctrl/Cmd + − 0): native page zoom so
  // vh/px layouts scale like browser zoom. The renderer owns the saved value.
  ipcMain.handle("ui-zoom-set", (e, pct: unknown) => {
    const n = typeof pct === "number" && Number.isFinite(pct) ? Math.min(200, Math.max(50, pct)) : 100;
    e.sender.setZoomFactor(n / 100);
    return n;
  });
  // Standard menus: without the Edit menu macOS disables Cmd+C/X/V/A/Z
  // app-wide (text can be selected but never copied). Roles give native
  // shortcuts + localized labels for free.
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    ...(isMac ? [{ role: "windowMenu" as const }] : []),
    {
      label: "Developer",
      submenu: [{
        label: "Toggle Developer Tools",
        accelerator: isMac ? "Alt+Command+I" : "Ctrl+Shift+I",
        click: () => mainWindow?.webContents.toggleDevTools(),
      }],
    },
  ]));
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

  mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupPageHtml())}`);
  try {
    // A previously-applied web bundle takes precedence over the baked one.
    const active = readActiveBundle(userDataDir);
    if (active) {
      activeEntry = entryPointsForDir(active.dir);
      runningBundleVersion = active.version;
      log(`[bundle] resuming ${active.version}`);
    }
    serverPort = await startServer(log);
    routeByEntitlement();
    // Silent boot-time track (connected flavors only — never blocks boot).
    void maybeAutoBundleUpdate(log);
    // First boot on this PC: offer the always-on setup (UAC + password).
    setTimeout(() => offerAlwaysOn(log), 4000);
    // Live activation pickup + revocation enforcement (fail-open, online only).
    setInterval(async () => {
      if (!LICENSE_ENFORCED) return; // activation removed: nothing to pick up or revoke
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
    const msg = String(e);
    log(`[boot] FATAL: ${msg}`);
    try {
      await mainWindow?.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(bootErrorPageHtml(msg, logFilePath()))}`
      );
    } catch {
      /* window gone */
    }
  }
});

app.on("before-quit", () => {
  quitting = true;
  try {
    serverChild?.kill();
  } catch {
    /* ignore */
  }
  stopTunnel();
});

app.on("window-all-closed", () => {
  // Never quit implicitly: the server must outlive the window (tray owns it).
  if (process.platform === "darwin" && quitting) app.quit();
});
