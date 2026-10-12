"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { mapImportHeaders, shapeImportRows, type ImportRow } from "@/lib/clients/import";

const BATCH = 50;

type Labels = Record<string, string>;

export function ClientImportModal({
  open,
  onClose,
  onDone,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  labels: Labels;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [noPhone, setNoPhone] = useState(0);
  const [inactive, setInactive] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setFileName("");
    setRows([]);
    setNoPhone(0);
    setInactive(0);
    setParseError(null);
    setProgress(null);
    setResult(null);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    reset();
    if (!f) return;
    setFileName(f.name);
    try {
      const ns = (await import("xlsx")) as unknown as Record<string, unknown>;
      const XLSX = (ns.default ?? ns) as {
        read: (data: ArrayBuffer, opts: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> };
        utils: { sheet_to_json: (ws: unknown, opts: Record<string, unknown>) => unknown[][] };
      };
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("empty");
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
      if (aoa.length < 2) throw new Error("empty");
      const cols = mapImportHeaders(aoa[0]);
      if (cols.name < 0) throw new Error("no_name_col");
      const { rows: shaped } = shapeImportRows(aoa.slice(1), cols, 2);
      if (shaped.length === 0) throw new Error("empty");
      setRows(shaped);
      setNoPhone(shaped.filter((r) => !r.phone).length);
      setInactive(shaped.filter((r) => !r.isActive).length);
    } catch {
      setParseError(labels.importBadFile);
    }
  }

  async function start() {
    if (rows.length === 0 || busy) return;
    setBusy(true);
    setResult(null);
    let created = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH).map((r) => ({
          name: r.name,
          phone: r.phone,
          email: r.email,
          address: r.address,
          isActive: r.isActive,
        }));
        const res = await fetch("/api/clients/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batch }),
        });
        if (!res.ok) throw new Error("batch_failed");
        const j = await res.json();
        created += Number(j.created ?? 0);
        skipped += (j.skipped ?? []).length;
        setProgress({ done: Math.min(i + BATCH, rows.length), total: rows.length });
      }
      setResult({ created, skipped });
      onDone();
    } catch {
      setParseError(labels.importFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={labels.importTitle}
      subtitle={labels.title}
      icon={<FileSpreadsheet size={18} />}
      width="lg"
    >
      <div className="space-y-4">
        <p className="text-xs leading-6 opacity-70">{labels.importHint}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={pick}
        />
        <Button onClick={() => fileRef.current?.click()} className="w-full">
          <Upload size={16} className="me-1" />
          {fileName || labels.importFile}
        </Button>
        {parseError && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{parseError}</p>}
        {rows.length > 0 && !result && (
          <div className="rounded-xl border border-(--border-default) p-3 text-sm">
            <div className="font-black tabular-nums">
              {rows.length} · {labels.importNoPhone}: {noPhone} · {labels.importInactive}: {inactive}
            </div>
            <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto text-xs opacity-80">
              {rows.slice(0, 8).map((r) => (
                <li key={r.line} className="flex justify-between gap-2" dir="auto">
                  <span className="truncate">{r.name}</span>
                  <span dir="ltr" className="shrink-0 tabular-nums opacity-70">{r.phone ?? "—"}</span>
                </li>
              ))}
              {rows.length > 8 && <li className="opacity-60">…</li>}
            </ul>
          </div>
        )}
        {progress && (
          <div className="h-2 overflow-hidden rounded-full bg-(--bg-sunken)">
            <div
              className="h-full rounded-full bg-(--brand-500) transition-all"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
        )}
        {result && (
          <p className="rounded-lg bg-emerald-500/10 p-2 text-sm font-bold text-emerald-600">
            {labels.importDone}: {result.created} ✓{result.skipped > 0 ? ` · ${labels.importSkipped}: ${result.skipped}` : ""}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {labels.cancel}
          </Button>
          {!result && (
            <Button onClick={start} disabled={rows.length === 0 || busy} className="shrink-0">
              {busy ? labels.importing : `${labels.importStart} (${rows.length})`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
