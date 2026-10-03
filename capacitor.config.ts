import type { CapacitorConfig } from "@capacitor/cli";

// Per-van APK packaging (see docs/APK.md). One app binary serves all vans:
// the device token (?device=…) or pasted token binds the install to its van.
const config: CapacitorConfig = {
  appId: "com.distribuili.van",
  appName: "Distribuili Van",
  webDir: "out-van",
  server: {
    // Production: phones open the live server directly — no setup screen,
    // no typing. Device token + first sync happen inside the app.
    url: "https://distribuili.khiatadz.com/ar/login?from=%2Fdashboard",
    cleartext: false,
    allowNavigation: ["distribuili.khiatadz.com"],
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
