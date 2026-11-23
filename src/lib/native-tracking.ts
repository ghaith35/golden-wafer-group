import { Capacitor, registerPlugin } from "@capacitor/core";

/// Web handle on the APK's always-on location service (native plugin
/// "VanTracking"). Older APKs don't ship it: every function then resolves to
/// null/false, so the app falls back to the in-page tracker and shipping this
/// web code before the new APK is safe.

export type TrackingStatus = {
  available: true;
  sdk: number;
  /// Precise location permission.
  fine: boolean;
  /// "Allow all the time".
  always: boolean;
  /// Notification permission (the service notification; Android 13+).
  notifications: boolean;
  /// App exempt from battery optimisation.
  battery: boolean;
  /// Location switched on in the phone's settings.
  gps: boolean;
  /// The service is switched on (and restarts by itself).
  enabled: boolean;
  lastReportAt: number;
  lastError: string;
  queued: number;
  manufacturer: string;
};

interface VanTrackingPlugin {
  status(): Promise<TrackingStatus>;
  requestFine(): Promise<TrackingStatus>;
  requestAlways(): Promise<TrackingStatus>;
  requestNotifications(): Promise<TrackingStatus>;
  requestBattery(): Promise<TrackingStatus>;
  openAppSettings(): Promise<TrackingStatus>;
  openLocationSettings(): Promise<TrackingStatus>;
  start(o: { baseUrl: string; deviceToken: string }): Promise<TrackingStatus>;
  stop(): Promise<TrackingStatus>;
}

let proxy: VanTrackingPlugin | null = null;
function plugin(): VanTrackingPlugin {
  if (!proxy) proxy = registerPlugin<VanTrackingPlugin>("VanTracking");
  return proxy;
}

function isApk(): boolean {
  try {
    if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return false;
    return (window as unknown as { distribuili?: { isDesktop?: boolean } }).distribuili?.isDesktop !== true;
  } catch {
    return false;
  }
}

/// Current status, or null when this isn't an APK that has the service.
export async function trackingStatus(): Promise<TrackingStatus | null> {
  if (!isApk()) return null;
  try {
    const s = await plugin().status();
    return s && s.available ? s : null;
  } catch {
    return null;
  }
}

async function call<K extends keyof VanTrackingPlugin>(k: K, ...args: Parameters<VanTrackingPlugin[K]>): Promise<TrackingStatus | null> {
  if (!isApk()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (plugin()[k] as any)(...args);
  } catch {
    return null;
  }
}

export const tracking = {
  requestFine: () => call("requestFine"),
  requestAlways: () => call("requestAlways"),
  requestNotifications: () => call("requestNotifications"),
  requestBattery: () => call("requestBattery"),
  openAppSettings: () => call("openAppSettings"),
  openLocationSettings: () => call("openLocationSettings"),
  start: (baseUrl: string, deviceToken: string) => call("start", { baseUrl, deviceToken }),
  stop: () => call("stop"),
};

/// What still blocks always-on tracking, in the order the driver should fix it.
export type Step = "fine" | "always" | "notifications" | "battery" | "gps";
export function missingSteps(s: TrackingStatus): Step[] {
  const out: Step[] = [];
  if (!s.fine) out.push("fine");
  if (!s.always) out.push("always");
  if (s.sdk >= 33 && !s.notifications) out.push("notifications");
  if (!s.battery) out.push("battery");
  if (!s.gps) out.push("gps");
  return out;
}
