import type { CapacitorConfig } from "@capacitor/cli";

// Per-van APK packaging (see docs/APK.md). One app binary serves all vans:
// the device token (?device=…) or pasted token binds the install to its van.
const config: CapacitorConfig = {
  appId: "com.distribuili.van",
  appName: "Distribuili Van",
  webDir: "out-van",
  server: {
    // Client-set server: the APK boots to the local setup page (out-van),
    // where the customer enters THEIR address (domain or LAN IP). The
    // WebView then loads it (allowNavigation below permits any host).
    // NOTE: shipping a fixed url here would hard-code OUR test server.
    cleartext: true,
    allowNavigation: ["*"],
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
