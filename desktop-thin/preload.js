// Bridge for the website (same name as the full desktop shell: window.distribuili).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("distribuili", {
  isDesktop: true,
  // { images: PNG data URLs, widthMm, heightMm } → prints at that exact paper size.
  printLabels: (args) => ipcRenderer.invoke("print-labels", args),
});
