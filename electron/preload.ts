import { contextBridge, ipcRenderer } from "electron";

type Handler = (...args: never[]) => Promise<unknown>;

function invoke(channel: string): Handler {
  return (...args: never[]) => ipcRenderer.invoke(channel, ...args);
}

// Present only inside the desktop shell. Web builds see `undefined`.
contextBridge.exposeInMainWorld("distribuili", {
  version: "0.1.6",
  isDesktop: true,
  licenseStatus: invoke("license-status"),
  licenseRegister: invoke("license-register"),
  licenseStartTrial: invoke("license-start-trial"),
  licenseCheck: invoke("license-check"),
  licenseEnterKey: invoke("license-enter-key"),
  licenseRedeemKey: invoke("license-redeem-key"),
  updateCheck: invoke("update-check"),
  updateDownload: invoke("update-download"),
  updateInstall: invoke("update-install"),
  bundleStatus: invoke("bundle-status"),
  bundleCheck: invoke("bundle-check"),
  bundleDownload: invoke("bundle-download"),
  bundleApply: invoke("bundle-apply"),
  onBundleProgress: (cb: (pct: number) => void) => {
    const listener = (_e: unknown, pct: number) => cb(pct);
    ipcRenderer.on("bundle-progress", listener as never);
    return () => ipcRenderer.removeListener("bundle-progress", listener as never);
  },
  serverGetUrl: invoke("server-get-url"),
  serverSaveUrl: invoke("server-save-url"),
  setZoom: invoke("ui-zoom-set"),
  pdfOpen: invoke("pdf-open"),
  pdfSave: invoke("pdf-save"),
  onUpdateProgress: (cb: (pct: number) => void) => {
    const listener = (_e: unknown, pct: number) => cb(pct);
    ipcRenderer.on("update-progress", listener as never);
    return () => ipcRenderer.removeListener("update-progress", listener as never);
  },
});

declare global {
  interface Window {
    distribuili?: {
      version: string;
      isDesktop: boolean;
      licenseStatus: () => Promise<never>;
      licenseRegister: (label?: string, phone?: string, info?: Record<string, string>) => Promise<never>;
      licenseStartTrial: (info: Record<string, string>) => Promise<never>;
      licenseCheck: () => Promise<never>;
      licenseEnterKey: (token: string) => Promise<never>;
      licenseRedeemKey: (key: string, label?: string, info?: Record<string, string>) => Promise<never>;
      updateCheck: () => Promise<never>;
      updateDownload: () => Promise<never>;
      updateInstall: () => Promise<never>;
      bundleStatus: () => Promise<never>;
      bundleCheck: () => Promise<never>;
      bundleDownload: () => Promise<never>;
      bundleApply: () => Promise<never>;
      serverGetUrl: () => Promise<never>;
      serverSaveUrl: (url: string) => Promise<never>;
      pdfOpen: (args: { fileName: string; base64: string }) => Promise<{ ok?: boolean; path?: string; error?: string }>;
      pdfSave: (args: { fileName: string; base64: string }) => Promise<{ ok?: boolean; canceled?: boolean; path?: string; error?: string }>;
      onUpdateProgress: (cb: (pct: number) => void) => () => void;
      onBundleProgress: (cb: (pct: number) => void) => () => void;
    };
  }
}
