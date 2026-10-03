"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

/// Delete confirmation with autofocused confirm (Enter confirms, Esc cancels).
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  message: string;
  confirmLabel?: string;
}) {
  const t = useTranslations("common");
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    const timer = window.setTimeout(() => confirmRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        confirmRef.current?.click();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open ]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={title} width="sm" icon="⚠️">
      <p className="text-sm text-(--text-secondary)">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("cancel")}
        </Button>
        <button
          ref={confirmRef}
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-red-500 px-4 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
        >
          {busy ? "…" : (confirmLabel ?? t("delete"))}
        </button>
      </div>
    </Modal>
  );
}
