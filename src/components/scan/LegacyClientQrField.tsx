"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CameraBox } from "@/components/scan/CameraBox";
import { isLegacyClientQr } from "@/lib/clients/qr";

export function LegacyClientQrField({
  value,
  onChange,
  changed,
  disabled,
}: {
  value?: string | null;
  onChange: (value: string | null) => void;
  changed: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("legacyClientQr");
  const scan = useTranslations("livreur");
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);

  return (
    <div className="space-y-2 rounded-xl border border-(--border-default) p-3">
      {value && <p className="text-sm font-semibold">{t(changed ? "selected" : "linked")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={disabled} onClick={() => { setOpen(!open); setInvalid(false); }}>
          <QrCode size={16} className="me-2" />
          {open ? scan("cancel") : value ? t("replace") : t("link")}
        </Button>
        {value && (
          <Button type="button" variant="ghost" disabled={disabled} onClick={() => { onChange(null); setOpen(false); setInvalid(false); }}>
            {t("unlink")}
          </Button>
        )}
      </div>
      {open && !disabled && (
        <CameraBox
          hint={t("hint")}
          onDetect={(text) => {
            const qr = text.trim();
            if (!isLegacyClientQr(qr)) {
              setInvalid(true);
              return;
            }
            onChange(qr);
            setOpen(false);
            setInvalid(false);
          }}
          labels={{
            scan: scan("scan"), gallery: scan("gallery"), qrNotFound: scan("qrNotFound"),
            camNeedHttps: scan("camNeedHttps"), camDenied: scan("camDenied"), camUnsupported: scan("camUnsupported"),
          }}
        />
      )}
      {invalid && <p role="alert" className="text-sm font-semibold text-red-500">{t("invalid")}</p>}
    </div>
  );
}
