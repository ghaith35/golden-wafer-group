"use client";

import { useState } from "react";
import { Camera, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { CameraBox } from "@/components/scan/CameraBox";
import { setDeviceToken, setSyncUrl, setVanId } from "@/lib/sync/client";
import { serverBaseOf, syncEndpointOf } from "@/lib/sync/urls";
import { cn } from "@/lib/utils";

export type SetupPayload = {
  app: string;
  type: string;
  url: string;
  token: string;
  van?: string;
  label?: string;
};

export function parseSetupPayload(text: string): SetupPayload | null {
  try {
    const d = JSON.parse(text) as Partial<SetupPayload>;
    if (d && d.app === "distribuili" && d.type === "device-setup" && typeof d.url === "string" && typeof d.token === "string" && d.url && d.token) {
      return d as SetupPayload;
    }
  } catch {
    /* not JSON — try raw token */
    if (/^[0-9a-f]{32,128}$/i.test(text.trim())) {
      return { app: "distribuili", type: "device-setup", url: "/api/sync", token: text.trim() };
    }
  }
  return null;
}

/// Server origin from any setup URL form: bare origin AND legacy payloads
/// carrying the full `/api/sync` endpoint both resolve to the origin.
export { serverBaseOf };
/// Sync endpoint from any setup URL form (same-origin default kept as-is).
export { syncEndpointOf };

/// First-sync setup: scan the admin's setup QR (or type the token + URL),
/// save device config, then the caller runs the first sync.
/// compact=true (driver first-run inside the Sync popup): Direct pair leads —
/// one tap binds the phone to the driver's van, no server fields. The QR /
/// manual setup stays available behind a collapsed toggle for the rare cases
/// (no van assigned, admin-issued token). compact=false keeps the full
/// setup visible (server rebind flow).
export function DeviceSetup({
  onConfigured,
  labels,
  compact = false,
}: {
  onConfigured: () => void;
  labels: Record<string, string>;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [directBusy, setDirectBusy] = useState(false);
  /// Compact mode: QR/manual setup hidden until the driver asks for it.
  const [showQr, setShowQr] = useState(false);

  /// Direct pairing: the logged-in staffer's own van, no QR, no admin.
  async function directSync() {
    if (directBusy) return;
    setDirectBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/devices/self-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.token) {
        setError(d?.error === "no_van" ? (labels.noVan ?? "no_van") : (d?.error ?? "failed"));
        return;
      }
      setDeviceToken(d.token);
      if (d.vanId) setVanId(d.vanId);
      onConfigured();
    } catch {
      setError("failed");
    } finally {
      setDirectBusy(false);
    }
  }

  function apply(p: SetupPayload) {
    setSaving(true);
    try {
      setDeviceToken(p.token);
      setSyncUrl(syncEndpointOf(p.url || "/api/sync"));
      onConfigured();
    } finally {
      setSaving(false);
    }
  }

  function onScan(text: string) {
    const p = parseSetupPayload(text);
    if (!p) {
      setError(labels.invalidQr ?? "invalid_qr");
      return;
    }
    setError(null);
    apply(p);
  }

  function saveManual() {
    if (!token.trim()) {
      setError(labels.tokenRequired ?? "token_required");
      return;
    }
    setError(null);
    apply({ app: "distribuili", type: "device-setup", url: url.trim() || "/api/sync", token: token.trim() });
  }

  return (
    <div className="space-y-3">
      <Button onClick={() => void directSync()} disabled={directBusy} className="h-12 w-full text-base">
        {directBusy ? "…" : `⚡ ${labels.directSync ?? "direct"}`}
      </Button>
      <p className="text-xs font-bold opacity-60">{labels.setupHint ?? ""}</p>
      {compact && !showQr ? (
        <button
          type="button"
          onClick={() => setShowQr(true)}
          className="mx-auto block text-[11px] font-bold opacity-50 underline"
        >
          {labels.scanSetup ?? "scan"}
        </button>
      ) : (
      <div className="flex gap-1 rounded-xl bg-(--bg-sunken) p-1">
        {(["scan", "manual"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(null); }}
            className={cn("flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-black", mode === m ? "bg-(--bg-overlay) shadow" : "opacity-60")}
          >
            {m === "scan" ? <Camera size={14} /> : <Keyboard size={14} />}
            {m === "scan" ? (labels.scanSetup ?? "scan") : (labels.manual ?? "manual")}
          </button>
        ))}
      </div>
      )}
      {(!compact || showQr) && (mode === "scan" ? (
        <CameraBox
          hint={labels.scanSetup ?? "scan"}
          onDetect={onScan}
          labels={{
            scan: labels.scanSetup ?? "scan",
            gallery: labels.gallery ?? "gallery",
            qrNotFound: labels.qrNotFound ?? "qr_not_found",
            camNeedHttps: labels.camNeedHttps ?? "",
            camDenied: labels.camDenied ?? "",
            camUnsupported: labels.camUnsupported ?? "",
          }}
        />
      ) : (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.tokenPh ?? "token"}</label>
            <Input value={token} onChange={(e) => setToken(e.target.value)} dir="ltr" placeholder="…" />
          </div>
          {/* Driver compact mode: the phone is already on the bound server
              origin, so same-origin sync needs no URL — the address is never
              shown to the driver. Full mode (admin rebind) keeps the field. */}
          {!compact && (
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.urlPh ?? "url"}</label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" placeholder="/api/sync" inputMode="url" />
          </div>
          )}
          <Button onClick={saveManual} disabled={saving || !token.trim()} className="w-full">
            {labels.saveConfig ?? "save"}
          </Button>
        </div>
      ))}
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500">{error}</p>}
    </div>
  );
}
