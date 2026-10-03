"use client";

/// Professional client membership card: company logo + enterprise name +
/// phone, big scannable QR, client code. Mirrors the printed loyalty cards
/// (light card, prints cleanly on any theme).

export type QrCompany = {
  name: string;
  phone: string | null;
  logoUrl: string | null;
};

export function ClientQrCard({
  company,
  clientName,
  clientCode,
  qrUrl,
}: {
  company: QrCompany | null;
  clientName: string;
  clientCode: string;
  qrUrl: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-(--border-default) bg-white text-black shadow-sm">
      <div className="h-1.5 bg-gradient-brand" />
      <div className="flex flex-col items-center px-5 pb-5 pt-4 text-center">
        {company?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="" className="h-14 w-14 rounded-2xl object-contain" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-(--brand-500)/10 text-2xl font-black text-(--brand-600)">
            {(company?.name ?? clientName).trim().charAt(0) || "•"}
          </span>
        )}
        <div className="mt-2 text-lg font-black leading-tight">{company?.name ?? ""}</div>
        {company?.phone && (
          <div className="mt-0.5 text-sm font-bold tabular-nums text-black/60" dir="ltr">
            {company.phone}
          </div>
        )}
        {clientName !== company?.name && (
          <div className="mt-1 max-w-full truncate text-sm font-bold text-black/70">{clientName}</div>
        )}
        <div className="mt-3 rounded-xl border border-black/10 bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt={clientCode} className="h-44 w-44" />
        </div>
        <div className="mt-2 font-mono text-sm font-black tracking-[0.2em]" dir="ltr">
          {clientCode}
        </div>
      </div>
    </div>
  );
}
