"use client";

import { useEffect } from "react";

/// Native hardware/gesture back button for the van APK.
///
/// Without a listener, the WebView's default history-back replays a Next
/// client-side transition: offline it fires an RSC fetch that fails and the
/// driver lands on a dead page (or the app just exits). With this listener:
/// - offline → hard-load the previous warmed page from the breadcrumb
///   (service worker answers from cache); nowhere to go → stay put, never
///   kill the app mid-journée;
/// - online → standard history-back, app exit when there is no history.
/// Web/PWA builds never register: the system back button stays untouched.
export function OfflineBackGuard() {
  useEffect(() => {
    let remove: (() => void) | undefined;
    try {
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      if (!cap?.isNativePlatform?.()) return;
      void import("@capacitor/app")
        .then(({ App }) => {
          const sub = App.addListener("backButton", () => {
            try {
              if (window.navigator?.onLine === false) {
                void import("@/lib/sync/client")
                  .then((m) => {
                    const prev = m.popCrumb();
                    if (prev) window.location.assign(prev);
                  })
                  .catch(() => {});
              } else if (window.history.length > 1) {
                window.history.back();
              } else {
                void App.exitApp();
              }
            } catch {
              /* never trap the driver */
            }
          });
          sub
            .then((s) => {
              remove = () => s.remove();
            })
            .catch(() => {});
        })
        .catch(() => {});
    } catch {
      /* web/PWA: system back stays untouched */
    }
    return () => {
      try {
        remove?.();
      } catch {
        /* ignore */
      }
    };
  }, []);
  return null;
}
