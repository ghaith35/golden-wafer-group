"use client";

import { useEffect, useState } from "react";

/// Height (px) the on-screen keyboard currently covers at the bottom of the
/// layout viewport, 0 when closed. Uses the Visual Viewport API so it is
/// correct on iOS Safari (keyboard overlays, fixed elements don't move) and
/// harmless on Android Chrome (layout resizes → 0). Small deltas (browser
/// toolbars collapsing, ~50-80px) are ignored on purpose.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      setInset(covered > 120 ? covered : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
