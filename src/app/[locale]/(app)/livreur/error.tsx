"use client";

import { useEffect } from "react";

import { errorPageText } from "@/lib/error-page-text";
/// Livreur crash catcher. Mid-tour the network can drop between two taps: the
/// next client-side transition then fails and — with no boundary — the whole
/// journée would die on Next's default error screen ("nothing works"). This
/// boundary turns any such crash into one recoverable card:
/// - full reload (primary): the service worker answers from cache offline,
///   fresh from the server online — always safe, never the dead error page;
/// - in-place retry (ghost): re-attempts the failed render, works the moment
///   the connection is back.
export default function LivreurError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const ep = errorPageText();
  useEffect(() => {
    try {
      console.error("[livreur-error]", error?.message ?? error);
    } catch {
      /* ignore */
    }
  }, [error]);

  const reload = () => {
    try {
      window.location.reload();
    } catch {
      try {
        window.location.assign(window.location.href);
      } catch {
        /* ignore */
      }
    }
  };

  /// Offline the failed page is unreachable by definition — step back in
  /// history (served from cache) instead of looping on it.
  const goBack = () => {
    try {
      if (window.history.length > 1) window.history.back();
      else window.location.reload();
    } catch {
      /* ignore */
    }
  };

  const errText = (() => {
    try {
      const m = String(error?.message ?? error ?? "unknown");
      const d = error?.digest ? ` [${error.digest}]` : "";
      return (m + d).slice(0, 500);
    } catch {
      return "unknown";
    }
  })();

  return (
    <div
      dir={ep.dir}
      style={{
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          textAlign: "center",
          border: "1px solid var(--border-default, #e2e8f0)",
          borderRadius: 16,
          padding: 28,
          background: "var(--bg-overlay, #fff)",
        }}
      >
        <div style={{ fontSize: 44 }}>⚠️</div>
        <h1 style={{ fontSize: 18, margin: "0 0 6px", fontWeight: 800 }}>{ep.t.title}</h1>
        <p style={{ fontSize: 13, opacity: 0.7, margin: "0 0 6px", lineHeight: 1.8 }}>
          {typeof navigator !== "undefined" && navigator.onLine === false
            ? ep.t.offlinePhone
            : ep.t.navPhone}
        </p>
        <p style={{ fontSize: 12, opacity: 0.55, margin: "0 0 14px" }}>
          vos ventes en attente sont conservées — rien n&apos;est perdu.
        </p>
        <button
          type="button"
          onClick={reload}
          style={{
            width: "100%",
            padding: 14,
            border: 0,
            borderRadius: 12,
            background: "#0d59a3",
            color: "#fff",
            fontSize: 16,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          {ep.t.reload}
        </button>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            width: "100%",
            marginTop: 10,
            padding: 12,
            borderRadius: 12,
            background: "transparent",
            border: "1px solid #94a3b8",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {ep.t.retry}
        </button>
        <button
          type="button"
          onClick={goBack}
          style={{
            width: "100%",
            marginTop: 10,
            padding: 12,
            borderRadius: 12,
            background: "transparent",
            border: "1px solid #94a3b8",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {ep.t.back}
        </button>
        <details style={{ marginTop: 12, fontSize: 11, opacity: 0.6, textAlign: "left" }}>
          <summary style={{ cursor: "pointer" }}>{ep.t.details}</summary>
          <pre dir="ltr" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{errText}</pre>
        </details>
      </div>
    </div>
  );
}
