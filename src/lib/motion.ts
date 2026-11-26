"use client";

import { useEffect, useState } from "react";

/// Shared motion helpers — one place for easing, timings, reduced-motion,
/// low-end detection, haptics and the open/close "presence" state machine.

export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
export const EASE_SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
/// Exit duration for popups — keep in sync with the `gw-out` CSS (globals.css).
export const EXIT_MS = 200;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/// Weak phones (<=2 cores-ish / <=2GB) get the "lite" class: no backdrop blur,
/// no stagger, no ripple. Set once at boot by <MotionBoot/>.
export function isLiteDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const n = navigator as Navigator & { deviceMemory?: number };
  return (n.hardwareConcurrency ?? 8) <= 3 || (n.deviceMemory ?? 8) <= 2;
}

export type HapticKind = "tap" | "select" | "success" | "warn" | "error";
const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  select: 5,
  success: [10, 40, 18],
  warn: [24, 50, 24],
  error: [40, 60, 40, 60, 40],
};

type NativeHaptics = typeof import("@capacitor/haptics");
let native: NativeHaptics | null = null;
let nativeTried = false;
/// Real taptic/vibration-motor feedback through the Capacitor Haptics plugin.
/// Present only in APKs built with it (and registered in RemoteBridgePatch);
/// older APKs and browsers fall back to navigator.vibrate.
function loadNative() {
  if (nativeTried) return;
  nativeTried = true;
  void (async () => {
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Haptics")) return;
      native = await import("@capacitor/haptics");
    } catch {
      /* plugin not available */
    }
  })();
}

/// Tactile feedback: native haptics in the APK, tiny vibration elsewhere,
/// silent no-op when unsupported or when reduced motion is on.
export function haptic(kind: HapticKind = "tap"): void {
  try {
    if (prefersReducedMotion()) return;
    loadNative();
    if (native) {
      const { Haptics, ImpactStyle, NotificationType } = native;
      if (kind === "success") void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
      else if (kind === "warn") void Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
      else if (kind === "error") void Haptics.notification({ type: NotificationType.Error }).catch(() => {});
      else void Haptics.impact({ style: kind === "select" ? ImpactStyle.Light : ImpactStyle.Medium }).catch(() => {});
      return;
    }
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    /* unsupported */
  }
}

/// Mount/unmount with an exit animation. `mounted` stays true for EXIT_MS after
/// `open` flips to false; `state` drives the `data-state` CSS hook.
export function usePresence(open: boolean, exitMs = EXIT_MS): { mounted: boolean; state: "open" | "closed" } {
  const [mounted, setMounted] = useState(open);
  // Derived-state pattern: becoming open mounts immediately (no effect lag).
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open) return;
    if (!mounted) return;
    const id = window.setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : exitMs);
    return () => window.clearTimeout(id);
  }, [open, mounted, exitMs]);
  return { mounted: mounted || open, state: open ? "open" : "closed" };
}
