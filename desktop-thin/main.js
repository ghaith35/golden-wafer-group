// Golden Wafer Group — thin desktop client (macOS DMG + Windows EXE).
// Opens the production site directly; no local server, no bundled data.
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

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
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
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
