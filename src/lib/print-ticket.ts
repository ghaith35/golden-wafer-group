import { Capacitor, registerPlugin } from "@capacitor/core";
import type { TicketLabels, TicketVM } from "@/components/sales/TicketView";
import { TICKET_HERO } from "@/lib/brand/ticketHero";
import { ticketNum as num, ticketShortDate as shortDate } from "@/lib/ticket-format";
import { btAvailable, requestBtPrint } from "@/lib/bt-printer";

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
  nis?: string | null;
  logoUrl?: string | null;
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/// Self-contained 58/80mm thermal facture (works offline except the logo).
export function ticketPrintHtml(
  t: TicketVM,
  company: TicketCompany,
  width: "80",
  labels: TicketLabels,
  lang: "ar" | "fr",
  opts?: { qrDataUrl?: string | null; origin?: string },
): string {
  const rtl = lang !== "fr";
  const total = Number(t.total ?? 0);
  const paid = Number(t.paid ?? 0);
  const due = Math.round((total - paid) * 100) / 100;
  const rows = (t.lines ?? [])
    .map(
      (l) => `<tr><td class="n">${esc(l.name ?? "")}${l.bonus ? `<br><span class="m b">&#9733; ${lang === "fr" ? "Gratuit" : "مجاني"}</span>` : ""}</td>` +
        `<td class="r">${esc(num(l.qty))}</td>` +
        `<td class="r">${esc(num(l.unitPrice))}</td>` +
        `<td class="r b">${esc(num(l.lineTotal))}</td></tr>`
    )
    .join("");
  return `<!DOCTYPE html><html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8">` +
    `<style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:monospace,monospace;font-size:12px}` +
    `.t{width:${width}mm;margin:0 auto;padding:2mm 4mm}.c{text-align:center}.b{font-weight:700}` +
    `h1{font-size:16px;margin:2px 0}.m{font-size:11px}.rule{border-top:1px dashed #000;margin:4px 0}` +
    `table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.n{word-break:break-word}.r{text-align:right;white-space:nowrap}` +
    `.row{display:flex;justify-content:space-between}.tot{font-size:14px}.qr{display:block;margin:4px auto;width:36mm}` +
    `*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.hero{display:block;margin:0 auto 4px;width:76%;height:auto}` +
    `.orn{display:flex;align-items:center;gap:4px;margin:6px 0}.orn i{flex:1;height:2px;background:#000}.orn b{font-size:9px}` +
    `.meta{display:flex;justify-content:space-between;border-top:3px double #000;border-bottom:3px double #000;padding:3px 0}` +
    `.drv{background:#000;color:#fff;border-radius:6px;padding:5px 8px;margin:6px 0;text-align:center}.drv .l{font-size:9px;letter-spacing:.25em;opacity:.8;font-weight:700}.drv .p{font-size:19px;font-weight:900;letter-spacing:1px;direction:ltr}` +
    `.cl{border:2px solid #000;border-radius:6px;padding:4px 6px;margin:6px 0}` +
    `.bar{background:#000;color:#fff;border-radius:6px;padding:5px 8px;margin:3px 0;font-size:16px;font-weight:900}.due{border:2px solid #000;border-radius:6px;padding:3px 8px;margin-top:3px;font-size:13px;font-weight:900}` +
    `@page{size:${width}mm auto;margin:0}</style></head><body><div class="t">` +
    `<img class="hero" src="${TICKET_HERO}">` +
    `<div class="c">` +
    (/golden\s*wafer/i.test(company.name ?? "") ? "" : `<h1>${esc(company.name ?? "")}</h1>`) +
    (company.address ? `<div class="m">${esc(company.address)}</div>` : "") +
    (company.phone ? `<div class="m b">${esc(company.phone)}</div>` : "") +
    `</div><div class="orn"><i></i><b>&#9670;</b><i></i></div>` +
    `<div class="meta"><span class="b">N° ${esc(t.number ?? "")}</span><span class="b">${esc(shortDate(t.date))}</span></div>` +
    (t.location?.name ? `<div class="c m b">${esc(t.location.name)}</div>` : "") +
    (t.seller || t.sellerPhone
      ? `<div class="drv"><div class="l">${esc(String(labels.seller ?? "").toUpperCase())}</div>` +
        (t.seller && t.seller !== t.sellerPhone ? `<div class="b">${esc(t.seller)}</div>` : "") +
        (t.sellerPhone ? `<div class="p">&#9742; ${esc(t.sellerPhone)}</div>` : "") + `</div>`
      : "") +
    (t.client ? `<div class="cl"><div class="b" style="font-size:13px">${esc(t.client.name ?? "")}</div><div class="m">${esc(t.client.code ?? "")}${t.client.phone ? ` · ${esc(t.client.phone)}` : ""}</div></div>` : "") +
    `<div class="orn"><i></i><b>&#9670;</b><i></i></div>` +
    `<table>${rows}</table><div class="rule"></div>` +
    (Number(t.remise ?? 0) > 0 ? `<div class="row m"><span>${esc(labels.remise ?? "Remise")}</span><span>− ${esc(num(t.remise))}</span></div>` : "") +
    `<div class="row bar"><span>${esc(labels.total ?? "Total")}</span><span>${esc(num(t.total))}</span></div>` +
    `<div class="row"><span>${esc(labels.paid ?? "Paid")}</span><span>${esc(num(t.paid))}</span></div>` +
    `<div class="row due"><span>${esc(labels.due ?? "Due")}</span><span>${esc(num(due))}</span></div>` +
    `<div class="orn"><i></i><b>&#9670;</b><i></i></div>` +
    (opts?.qrDataUrl ? `<img class="qr" src="${opts.qrDataUrl}">` : "") +
    (labels.thanks ? `<div class="c b" style="font-size:13px">&#10022; ${esc(labels.thanks)} &#10022;</div>` : "") +
    // 1 cm of blank paper under the thank-you (tear-off margin).
    `<div style="height:10mm"></div>` +
    `</div></body></html>`;
}

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/// Desktop shell (dmg/exe): never the Capacitor native path — the desktop
/// prints through window.print() (system dialog, printer picker), which
/// works in Electron. Without this guard a misdetected platform would
/// surface "plugin is not implemented" instead of printing.
function isDesktop(): boolean {
  try {
    return (
      (window as unknown as { distribuili?: { isDesktop?: boolean } }).distribuili?.isDesktop === true
    );
  } catch {
    return false;
  }
}

export type TicketPrinterPlugin = {
  print: (o: { html: string; name: string; widthMm?: number }) => Promise<unknown>;
};

export type PrintTicketResult = { ok: true } | { ok: false; reason: string };

/// Print via the native system dialog (printer picker: Bluetooth / network /
/// USB print services). Returns a reason when the dialog could NOT open so
/// the caller can say so loudly instead of a dead button.
/// The plugin is resolved the Capacitor-idiomatic way (registerPlugin —
/// required since v7 for custom native plugins) with the legacy
/// window.Capacitor.Plugins lookup as fallback.
export type PrintArgs = {
  ticket: TicketVM;
  company: TicketCompany;
  width: "80";
  labels: TicketLabels;
  lang: "ar" | "fr";
  qrDataUrl?: string | null;
};

/// Print entry point for every APK "Print" button.
/// 1. Direct Bluetooth (BtPrinter plugin): opens the in-app printer screen —
///    search/select the Bluetooth printer, print, no system dialog.
/// 2. Fallback — old APK without the plugin, no Bluetooth, or no host mounted:
///    the Android system print dialog (printTicketSystem), exactly as before.
export async function printTicketNative(args: PrintArgs): Promise<PrintTicketResult> {
  try {
    if (typeof window !== "undefined" && isNative() && !isDesktop() && (await btAvailable()) && requestBtPrint(args)) {
      return { ok: true };
    }
  } catch {
    /* any failure here → system dialog below */
  }
  return printTicketSystem(args);
}

export async function printTicketSystem(args: PrintArgs): Promise<PrintTicketResult> {
  try {
    if (typeof window === "undefined" || !isNative() || isDesktop())
      return { ok: false, reason: isDesktop() ? "desktop_window_print" : "not_native" };
    const origin = window.location.origin;
    const html = ticketPrintHtml(args.ticket, args.company, args.width, args.labels, args.lang, {
      qrDataUrl: args.qrDataUrl ?? null,
      origin,
    });
    const name = `facture-${String(args.ticket.number ?? "ticket")}`;
    const widthMm = 80;
    // 1. Capacitor-idiomatic proxy (bridges to the native TicketPrinter).
    try {
      const plugin = registerPlugin<TicketPrinterPlugin>("TicketPrinter");
      await plugin.print({ html, name, widthMm });
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
      await plugin.print({ html, name, widthMm });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "print_failed" };
    }
  } catch {
    return { ok: false, reason: "print_failed" };
  }
}
