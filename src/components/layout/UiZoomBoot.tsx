"use client";

import { useEffect } from "react";
import { getZoom, installZoomKeys, setZoom } from "@/lib/ui-zoom";

/// Mounted once in the locale layout: re-applies the saved zoom on every
/// document load (login included) and wires Ctrl/Cmd +, −, 0.
export function UiZoomBoot() {
  useEffect(() => {
    setZoom(getZoom());
    return installZoomKeys();
  }, []);
  return null;
}
