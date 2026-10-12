package com.distribuili.van;

import android.content.Context;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
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
@CapacitorPlugin(name = "TicketPrinter")
public class TicketPrinter extends Plugin {

    /// Off-screen WebViews must survive until the print job is handed over.
    private final List<WebView> liveViews = new ArrayList<>();

    @PluginMethod
    public void print(PluginCall call) {
        String html = call.getString("html");
        String name = call.getString("name", "ticket");
        if (html == null || html.isEmpty()) {
            call.reject("missing_html");
            return;
        }
        if (getActivity() == null) {
            call.reject("no_activity");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Context ctx = getContext();
                PrintManager pm = (PrintManager) ctx.getSystemService(Context.PRINT_SERVICE);
                if (pm == null) {
                    call.reject("no_print_service");
                    return;
                }
                WebView wv = new WebView(ctx);
                // Off-screen but laid out: the print adapter needs measured content.
                wv.layout(0, 0, 600, 1200);
                liveViews.add(wv);
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        super.onPageFinished(view, url);
                        // Let remote images (logo) settle before measuring.
                        view.postDelayed(() -> {
                            try {
                                PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(name);
                                // Null attributes = printer defaults; the HTML
                                // carries its own @page size (58/80mm).
                                pm.print(name, adapter, null);
                                call.resolve();
                            } catch (Exception e) {
                                call.reject(e.getMessage() != null ? e.getMessage() : "print_failed");
                            } finally {
                                view.postDelayed(() -> {
                                    try { view.destroy(); } catch (Exception ignored) {}
                                    liveViews.remove(view);
                                }, 60_000);
                            }
                        }, 400);
                    }
                });
                wv.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "print_failed");
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        for (WebView wv : liveViews) {
            try { wv.destroy(); } catch (Exception ignored) {}
        }
        liveViews.clear();
    }
}
