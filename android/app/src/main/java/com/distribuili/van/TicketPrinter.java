package com.distribuili.van;

import android.content.Context;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

/// Thermal-ticket printing for the van phone: Android WebViews ignore
/// window.print(), so this plugin renders the facture HTML off-screen and
/// hands it to the system PrintManager — the driver gets the REAL printer
/// picker (network / Bluetooth / USB print services) instead of a dead
/// button. Registered in MainActivity; called from the web app as
/// Capacitor.Plugins.TicketPrinter.print({ html, name }).
///
/// The print WebView MUST be attached to the window hierarchy (invisible,
/// 1x1 px): a detached WebView never runs a measure/layout pass, so its
/// print adapter emits BLANK pages — the dialog opens, the job "succeeds",
/// nothing comes out of the printer. That was the production bug.
@CapacitorPlugin(name = "TicketPrinter")
public class TicketPrinter extends Plugin {

    /// Off-screen WebViews must survive until the print job is handed over.
    private final List<WebView> liveViews = new ArrayList<>();

    @PluginMethod
    public void print(PluginCall call) {
        String html = call.getString("html");
        String name = call.getString("name", "ticket");
        // Thermal roll width from the app's ticket setting (58/80mm): the
        // dialog would otherwise default to A4 (system default when no
        // thermal printer is pre-selected). Falls back to defaults if the
        // printer rejects the custom size.
        int widthMm = call.getInt("widthMm", 80);
        if (widthMm != 58 && widthMm != 80) widthMm = 80;
        final int rollWidthMm = widthMm;
        if (html == null || html.isEmpty()) {
            call.reject("missing_html");
            return;
        }
        if (getActivity() == null) {
            call.reject("no_activity");
            return;
        }
        getActivity().runOnUiThread(() -> {
            WebView wv = null;
            try {
                Context ctx = getContext();
                PrintManager pm = (PrintManager) ctx.getSystemService(Context.PRINT_SERVICE);
                if (pm == null) {
                    call.reject("no_print_service");
                    return;
                }
                final ViewGroup root =
                    (ViewGroup) getActivity().getWindow().getDecorView();
                wv = new WebView(ctx);
                wv.setVisibility(View.INVISIBLE);
                // Attached AND real ticket width: a 1px view never produces a
                // usable layout, so the print adapter emits BLANK pages. 576px
                // ≈ 80mm thermal width; the adapter scales to the printer.
                // INVISIBLE (not GONE): participates in measure/layout while
                // staying off-screen. Height wraps the ticket content.
                root.addView(
                    wv,
                    new ViewGroup.LayoutParams(
                        576, ViewGroup.LayoutParams.WRAP_CONTENT));
                liveViews.add(wv);
                final WebView view = wv;
                final PrintManager printManager = pm;
                view.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView v, String url) {
                        super.onPageFinished(v, url);
                        // Wait until the engine has measured real content
                        // (the logo may still be loading — the ticket itself
                        // is local HTML, so contentHeight gates the layout,
                        // not the network). Print anyway after ~4s, never hang.
                        v.postDelayed(new Runnable() {
                            int tries = 0;

                            @Override
                            public void run() {
                                if (view.getContentHeight() > 0 || ++tries > 30) {
                                    view.postDelayed(() -> doPrint(view, printManager, name, rollWidthMm, call), 400);
                                } else {
                                    view.postDelayed(this, 120);
                                }
                            }
                        }, 300);
                    }

                    @Override
                    public void onReceivedError(
                        WebView v,
                        android.webkit.WebResourceRequest request,
                        android.webkit.WebResourceError error
                    ) {
                        super.onReceivedError(v, request, error);
                        // Sub-resource failures (offline logo) must not kill
                        // the ticket: onPageFinished still fires for the
                        // document itself, which is all the adapter needs.
                    }
                });
                wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                if (wv != null) detach(wv);
                call.reject(e.getMessage() != null ? e.getMessage() : "print_failed");
            }
        });
    }

    private void doPrint(WebView view, PrintManager pm, String name, int widthMm, PluginCall call) {
        try {
            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(name);
            try {
                // Ask for the thermal roll explicitly (narrow preview instead
                // of A4). Length 297mm paginates longer tickets; the roll
                // service cuts per page. NO_MARGINS = full-bleed ticket.
                int widthMils = (int) Math.round(widthMm * 1000.0 / 25.4);
                PrintAttributes.MediaSize media = new PrintAttributes.MediaSize(
                    "ticket_" + widthMm, widthMm + "mm roll", widthMils, 11693);
                PrintAttributes attrs = new PrintAttributes.Builder()
                    .setMediaSize(media)
                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                    .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                    .build();
                pm.print(name, adapter, attrs);
            } catch (Exception ignored) {
                // Printer rejected the custom size — system defaults (A4)
                // still let the user pick paper manually in the dialog.
                pm.print(name, adapter, null);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "print_failed");
        } finally {
            // The framework snapshots the adapter at print() time — detach
            // after a grace delay, keep the instance alive a while longer
            // for slow jobs.
            view.postDelayed(() -> detach(view), 5_000);
        }
    }

    private void detach(WebView view) {
        try {
            if (getActivity() != null) {
                final ViewGroup root =
                    (ViewGroup) getActivity().getWindow().getDecorView();
                root.removeView(view);
            }
        } catch (Exception ignored) {
            /* already gone */
        }
        try {
            view.destroy();
        } catch (Exception ignored) {
            /* already gone */
        }
        liveViews.remove(view);
    }

    @Override
    protected void handleOnDestroy() {
        for (WebView wv : new ArrayList<>(liveViews)) {
            detach(wv);
        }
        liveViews.clear();
    }
}
