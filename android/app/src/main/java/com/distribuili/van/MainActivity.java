package com.distribuili.van;

import android.os.Bundle;
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
        super.onCreate(savedInstanceState);
    }
}
