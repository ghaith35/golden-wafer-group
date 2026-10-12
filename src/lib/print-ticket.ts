import { Capacitor, registerPlugin } from "@capacitor/core";
import type { TicketLabels, TicketVM } from "@/components/sales/TicketView";

/// Thermal-ticket printing for the APK: window.print() is a no-op inside the
/// native WebView, so the facture is rendered to self-contained HTML (no
/// app CSS needed) and handed to the TicketPrinter native plugin, which
/// opens the SYSTEM print dialog — the driver picks the printer
/// (network / Bluetooth / USB print service) instead of a dead button.
/// Web/desktop keep the print-stylesheet path (window.print works there).

export type TicketCompany = {
  name: string;
  phone?: string | null;
  address?: string | null;
  rc?: string | null;
  nif?: string | null;
  logoUrl?: string | null;
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(v: unknown): string {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "0";
}

function shortDate(iso: unknown): string {
  try {
    const d = new Date(String(iso ?? ""));
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

/// Absolute logo URL (the off-screen print WebView needs a full URL).
function logoSrc(logoUrl: string | null | undefined, origin: string): string | null {
  if (!logoUrl) return null;
  try {
    if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
    if (logoUrl.startsWith("/")) return origin.replace(/\/+$/, "") + logoUrl;
    return `${origin.replace(/\/+$/, "")}/${logoUrl}`;
  } catch {
    return null;
  }
}

/// Self-contained 58/80mm thermal facture (works offline except the logo).
export function ticketPrintHtml(
  t: TicketVM,
  company: TicketCompany,
  width: "58" | "80",
  labels: TicketLabels,
  lang: "ar" | "fr",
  opts?: { qrDataUrl?: string | null; origin?: string },
): string {
  const rtl = lang !== "fr";
  const total = Number(t.total ?? 0);
  const paid = Number(t.paid ?? 0);
  const due = Math.round((total - paid) * 100) / 100;
  const logo = opts?.origin ? logoSrc(company.logoUrl ?? null, opts.origin) : null;
  const rows = (t.lines ?? [])
    .map(
      (l) => `<tr><td class="n">${esc(l.name ?? "")}</td>` +
        `<td class="r">${esc(num(l.qty))}</td>` +
        `<td class="r">${esc(num(l.unitPrice))}</td>` +
        `<td class="r b">${esc(num(l.lineTotal))}</td></tr>`
    )
    .join("");
  return `<!DOCTYPE html><html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8">` +
    `<style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:monospace,monospace;font-size:12px}` +
    `.t{width:${width}mm;margin:0 auto;padding:2mm}.c{text-align:center}.b{font-weight:700}` +
    `h1{font-size:16px;margin:2px 0}.m{font-size:11px}.rule{border-top:1px dashed #000;margin:4px 0}` +
    `table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.n{word-break:break-word}.r{text-align:right;white-space:nowrap}` +
    `.row{display:flex;justify-content:space-between}.tot{font-size:14px}.qr{display:block;margin:4px auto;width:36mm}` +
    `@page{size:${width}mm auto;margin:0}</style></head><body><div class="t">` +
    (logo ? `<div class="c"><img src="${esc(logo)}" style="max-height:14mm;max-width:100%"></div>` : "") +
    `<div class="c"><h1>${esc(company.name ?? "")}</h1>` +
    (company.address ? `<div class="m">${esc(company.address)}</div>` : "") +
    (company.phone ? `<div class="m b">${esc(company.phone)}</div>` : "") +
    (company.rc || company.nif ? `<div class="m">${esc([company.rc ? `RC: ${company.rc}` : "", company.nif ? `NIF: ${company.nif}` : ""].filter(Boolean).join(" · "))}</div>` : "") +
    `</div><div class="rule"></div>` +
    `<div class="row"><span class="b">N° ${esc(t.number ?? "")}</span><span>${esc(shortDate(t.date))}</span></div>` +
    (t.client ? `<div class="b">${esc(t.client.name ?? "")}</div><div class="m">${esc(t.client.code ?? "")}${t.client.phone ? ` · ${esc(t.client.phone)}` : ""}</div>` : "") +
    `<div class="rule"></div>` +
    `<table>${rows}</table><div class="rule"></div>` +
    (Number(t.remise ?? 0) > 0 ? `<div class="row m"><span>${esc(labels.remise ?? "Remise")}</span><span>− ${esc(num(t.remise))}</span></div>` : "") +
    `<div class="row tot b"><span>${esc(labels.total ?? "Total")}</span><span>${esc(num(t.total))}</span></div>` +
    `<div class="row"><span>${esc(labels.paid ?? "Paid")}</span><span>${esc(num(t.paid))}</span></div>` +
    `<div class="row b"><span>${esc(labels.due ?? "Due")}</span><span>${esc(num(due))}</span></div>` +
    `<div class="rule"></div>` +
    (opts?.qrDataUrl ? `<img class="qr" src="${opts.qrDataUrl}">` : "") +
    (labels.thanks ? `<div class="c m b">${esc(labels.thanks)}</div>` : "") +
    `</div></body></html>`;
}

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export type TicketPrinterPlugin = {
  print: (o: { html: string; name: string }) => Promise<unknown>;
};

export type PrintTicketResult = { ok: true } | { ok: false; reason: string };

/// Print via the native system dialog (printer picker: Bluetooth / network /
/// USB print services). Returns a reason when the dialog could NOT open so
/// the caller can say so loudly instead of a dead button.
/// The plugin is resolved the Capacitor-idiomatic way (registerPlugin —
/// required since v7 for custom native plugins) with the legacy
/// window.Capacitor.Plugins lookup as fallback.
export async function printTicketNative(args: {
  ticket: TicketVM;
  company: TicketCompany;
  width: "58" | "80";
  labels: TicketLabels;
  lang: "ar" | "fr";
  qrDataUrl?: string | null;
}): Promise<PrintTicketResult> {
  try {
    if (typeof window === "undefined" || !isNative()) return { ok: false, reason: "not_native" };
    const origin = window.location.origin;
    const html = ticketPrintHtml(args.ticket, args.company, args.width, args.labels, args.lang, {
      qrDataUrl: args.qrDataUrl ?? null,
      origin,
    });
    const name = `facture-${String(args.ticket.number ?? "ticket")}`;
    // 1. Capacitor-idiomatic proxy (bridges to the native TicketPrinter).
    try {
      const plugin = registerPlugin<TicketPrinterPlugin>("TicketPrinter");
      await plugin.print({ html, name });
      return { ok: true };
    } catch {
      /* fall through to the legacy lookup */
    }
    // 2. Legacy window lookup (older shells).
    try {
      const cap = window as unknown as {
        Capacitor?: { Plugins?: { TicketPrinter?: TicketPrinterPlugin } };
      };
      const plugin = cap?.Capacitor?.Plugins?.TicketPrinter;
      if (!plugin) return { ok: false, reason: "no_plugin" };
      await plugin.print({ html, name });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "print_failed" };
    }
  } catch {
    return { ok: false, reason: "print_failed" };
  }
}
