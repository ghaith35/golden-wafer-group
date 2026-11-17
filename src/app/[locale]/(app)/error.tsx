"use client";

import { useEffect } from "react";

import { errorPageText } from "@/lib/error-page-text";
/// App-wide crash catcher (admin/desktop + any route without its own
/// boundary). Same contract as the livreur boundary: a full reload is always
/// safe — the service worker answers from cache when offline, the server
/// answers when online — so a dropped connection mid-click degrades to one
/// recoverable card instead of a dead app.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const ep = errorPageText();
  useEffect(() => {
    try {
      console.error("[app-error]", error?.message ?? error);
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
        <p style={{ fontSize: 13, opacity: 0.7, margin: "0 0 14px", lineHeight: 1.8 }}>
          {typeof navigator !== "undefined" && navigator.onLine === false
            ? ep.t.offline
            : ep.t.nav}
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
