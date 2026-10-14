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
                // Attached but invisible: participates in measure/layout, so
                // the print adapter renders real content; 1px, no flicker.
                root.addView(wv, new ViewGroup.LayoutParams(1, 1));
                liveViews.add(wv);
                final WebView view = wv;
                view.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView v, String url) {
                        super.onPageFinished(v, url);
                        // Let remote images (logo) settle before measuring.
                        v.postDelayed(() -> {
                            try {
                                PrintDocumentAdapter adapter = v.createPrintDocumentAdapter(name);
                                // Null attributes = printer defaults; the HTML
                                // carries its own @page size (58/80mm).
                                pm.print(name, adapter, null);
                                call.resolve();
                            } catch (Exception e) {
                                call.reject(e.getMessage() != null ? e.getMessage() : "print_failed");
                            } finally {
                                // The framework snapshots the adapter at print()
                                // time — detach after a grace delay, keep the
                                // instance alive a while longer for slow jobs.
                                v.postDelayed(() -> detach(view), 5_000);
                            }
                        }, 400);
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
                wv.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
            } catch (Exception e) {
                if (wv != null) detach(wv);
                call.reject(e.getMessage() != null ? e.getMessage() : "print_failed");
            }
        });
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
