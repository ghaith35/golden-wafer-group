"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isNative } from "@/lib/sync/client";

/// Renders children ONLY inside the Android van APK (Capacitor shell).
/// Sync pills/popups, connection-lost dialog, GPS prompt and offline badges
/// belong to the phone app — desktop (EXE/DMG) and the plain web never show
/// them. Starts hidden so server HTML and first client render match.
export function ApkOnly({ children }: { children: ReactNode }) {
  const [apk, setApk] = useState(false);
  useEffect(() => setApk(isNative()), []);
  return apk ? <>{children}</> : null;
}
