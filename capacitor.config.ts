import type { CapacitorConfig } from "@capacitor/cli";

// Universal APK: one binary serves every client.
// No `server.url` on purpose — the app boots the bundled launcher
// (out-van/index.html): the driver scans his client's server QR once, and the
// launcher remembers it forever (auto-connect on every launch, no rescan).
// Per-client locked builds are still possible by re-adding server.url.
const localLanTest = process.env.DISTRIBUILI_LOCAL_LAN_TEST === "1";
const config: CapacitorConfig = {
  appId: localLanTest ? "com.distribuili.van.localtest" : "com.distribuili.van",
  appName: localLanTest ? "Distribuili Van Local Test" : "Distribuili Van",
  webDir: "out-van",
  server: {
    cleartext: localLanTest,
    // Permanent offline guard: ANY main-frame load failure (DNS, offline,
    // timeout, HTTP error) redirects to this LOCAL file instead of the
    // Chrome "page unavailable" error. It shares origin + localStorage with
    // the launcher, so it can read the saved server and offer retry.
    // Handled natively by BridgeWebViewClient via bridge.getErrorUrl().
    // Never remove or rename without keeping a replacement.
    errorPath: "offline.html",
    // Apex + every client subdomain. Wildcard `*` matches exactly one label
    // (HostMask): dist-client1.khiatadz.com ✓, evil sub chains ✗.
    // NOTE: one level below the zone only — the free edge cert never covers
    // two levels (client1.distribuili.khiatadz.com ✗). Old entries kept
    // during the migration, then removable.
    allowNavigation: [
      "distribuili.khiatadz.com",
      "*.distribuili.khiatadz.com",
      "khiatadz.com",
      "*.khiatadz.com",
      ...(localLanTest ? ["192.168.100.47"] : []),
    ],
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
