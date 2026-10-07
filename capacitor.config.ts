import type { CapacitorConfig } from "@capacitor/cli";

// Universal APK: one binary serves every client.
// No `server.url` on purpose — the app boots the bundled launcher
// (out-van/index.html): the driver scans his client's server QR once, and the
// launcher remembers it forever (auto-connect on every launch, no rescan).
// Per-client locked builds are still possible by re-adding server.url.
const config: CapacitorConfig = {
  appId: "com.distribuili.van",
  appName: "Distribuili Van",
  webDir: "out-van",
  server: {
    cleartext: false,
    // Apex + every client subdomain. Wildcard `*` matches exactly one label
    // (HostMask): client1.distribuili.khiatadz.com ✓, evil sub chains ✗.
    allowNavigation: ["distribuili.khiatadz.com", "*.distribuili.khiatadz.com"],
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
