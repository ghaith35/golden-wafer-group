package com.distribuili.van;

import android.os.Bundle;
import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;

// Permanent offline guard: DO NOT add a custom WebViewClient here.
// Chrome-error suppression is handled by `server.errorPath: "offline.html"`
// in capacitor.config.ts — BridgeWebViewClient automatically loads that
// LOCAL file (same origin, shared localStorage) on ANY main-frame
// onReceivedError / onReceivedHttpError (DNS, offline, timeout, 5xx).
// Custom clients risk breaking the Capacitor bridge (plugins, local server).
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Custom native plugins must register BEFORE super.onCreate() loads
        // the bridge: TicketPrinter (thermal-ticket system print dialog —
        // window.print() is a no-op inside the APK WebView).
        registerPlugin(TicketPrinter.class);
        // BtPrinter: direct Bluetooth (ESC/POS) thermal printing, no system dialog.
        registerPlugin(BtPrinter.class);
        // VanTracking: always-on location service (permission steps, start/stop, status).
        registerPlugin(VanTracking.class);
        super.onCreate(savedInstanceState);
        // Remote pages (client https servers opened from the launcher) never
        // get the native bridge injection — re-graft it after each page load
        // so print/share/filesystem work there too. Local pages self-skip.
        RemoteBridgePatch.attach(getBridge());
    }

    // Session never dies: the 365-day login cookies are set by the page, not
    // through Capacitor's cookie plugin, so nothing forces them to disk. Flush
    // whenever the app leaves the foreground — a swipe-kill right after login
    // can no longer lose the session.
    @Override
    public void onPause() {
        super.onPause();
        try { CookieManager.getInstance().flush(); } catch (Exception ignored) {}
    }

    @Override
    public void onStop() {
        super.onStop();
        try { CookieManager.getInstance().flush(); } catch (Exception ignored) {}
    }
}
