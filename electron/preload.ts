import { contextBridge, ipcRenderer } from "electron";

type Handler = (...args: never[]) => Promise<unknown>;

function invoke(channel: string): Handler {
  return (...args: never[]) => ipcRenderer.invoke(channel, ...args);
}

// Present only inside the desktop shell. Web builds see `undefined`.
contextBridge.exposeInMainWorld("distribuili", {
  version: "0.1.0",
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
  serverGetUrl: invoke("server-get-url"),
  serverSaveUrl: invoke("server-save-url"),
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
      licenseRegister: (label?: string, phone?: string) => Promise<never>;
      licenseStartTrial: (info: Record<string, string>) => Promise<never>;
      licenseCheck: () => Promise<never>;
      licenseEnterKey: (token: string) => Promise<never>;
      licenseRedeemKey: (key: string, label?: string) => Promise<never>;
      updateCheck: () => Promise<never>;
      updateDownload: () => Promise<never>;
      updateInstall: () => Promise<never>;
      serverGetUrl: () => Promise<never>;
      serverSaveUrl: (url: string) => Promise<never>;
      onUpdateProgress: (cb: (pct: number) => void) => () => void;
    };
  }
}
