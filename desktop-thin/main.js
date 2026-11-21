// Golden Wafer Group — thin desktop client (macOS DMG + Windows EXE).
// Opens the production site directly; no local server, no bundled data.
const { app, BrowserWindow, shell, Menu, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const SITE_URL = process.env.GW_SITE_URL || "https://golden-wafer-group.khiatadz.com/ar/dashboard";
const ORIGIN = new URL(SITE_URL).origin;

// One window only: opening the app twice focuses the existing one.
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    title: "Golden Wafer Group",
    icon: path.join(__dirname, "build", process.platform === "win32" ? "icon.ico" : "icon.icns"),
    backgroundColor: "#f7f1e1",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload.js") },
  });
  win.maximize();
  win.loadURL(SITE_URL);

  // Same-site links stay in the app; everything else opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin === ORIGIN) return { action: "allow" };
    } catch {
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    try {
      if (new URL(url).origin !== ORIGIN && !url.startsWith("file:")) {
        e.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      e.preventDefault();
    }
  });

  // Offline / server unreachable: a retry screen, never a blank window.
  win.webContents.on("did-fail-load", (_e, _code, _desc, _url, isMainFrame) => {
    if (!isMainFrame) return;
    win.loadFile(path.join(__dirname, "offline.html"), { query: { u: SITE_URL } });
  });
}

// Exact-size label printing: the page sends one PNG per label + the paper size
// in mm. A hidden window lays them out with @page { size } and print() gets the
// same pageSize, so the paper follows the size picked in the app instead of the
// printer driver's default.
ipcMain.handle("print-labels", async (e, args) => {
  try {
    if (!e.senderFrame || new URL(e.senderFrame.url).origin !== ORIGIN) return { ok: false, error: "forbidden" };
    const images = Array.isArray(args && args.images) ? args.images.map(String) : [];
    const w = Math.round(Number(args && args.widthMm));
    const h = Math.round(Number(args && args.heightMm));
    if (!images.length || !(w >= 20 && w <= 300) || !(h >= 20 && h <= 300)) return { ok: false, error: "bad-args" };
    const dir = path.join(os.tmpdir(), "gw-labels", String(Date.now()));
    fs.mkdirSync(dir, { recursive: true });
    const tags = images.map((d, i) => {
      const m = /^data:image\/png;base64,(.+)$/.exec(d);
      if (!m) throw new Error("bad-image");
      fs.writeFileSync(path.join(dir, `p${i}.png`), Buffer.from(m[1], "base64"));
      return `<img src="p${i}.png">`;
    });
    const html =
      `<!doctype html><meta charset="utf-8"><style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0}` +
      `img{display:block;width:${w}mm;height:${h}mm;page-break-after:always;break-after:page}` +
      `img:last-child{page-break-after:auto;break-after:auto}</style>${tags.join("")}`;
    const file = path.join(dir, "labels.html");
    fs.writeFileSync(file, html);
    const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      await pw.loadFile(file);
      return await new Promise((resolve) => {
        pw.webContents.print(
          { silent: false, printBackground: true, margins: { marginType: "none" }, pageSize: { width: w * 1000, height: h * 1000 } },
          (ok, reason) => {
            if (ok) resolve({ ok: true });
            else if (/cancel/i.test(reason || "")) resolve({ ok: false, canceled: true });
            else resolve({ ok: false, error: reason || "print-failed" });
          }
        );
      });
    } finally {
      pw.destroy();
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
