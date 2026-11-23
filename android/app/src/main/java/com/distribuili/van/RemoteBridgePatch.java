package com.distribuili.van;

import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethodHandle;
import com.getcapacitor.WebViewListener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/// Remote pages (the client's own https servers, opened from the bundled
/// launcher) never receive the native bridge injection — it targets the
/// LOCAL launcher origin only. Native calls from those pages therefore throw
/// "not implemented on android", even though the androidBridge message
/// channel works there. This re-grafts toNative/fromNative + the real
/// PluginHeaders after each full page load (local pages already have the
/// bridge — the graft self-skips there, and it mutates rather than replaces
/// window.Capacitor so the page's own runtime keeps working).
public final class RemoteBridgePatch {

    /// Plugins the web app may call from remote pages. Unregistered ids are
    /// skipped — this list can grow without touching anything else.
    private static final List<String> PLUGIN_IDS = Arrays.asList(
        "TicketPrinter", "BtPrinter", "VanTracking", "App", "Filesystem", "Share", "Browser", "Geolocation"
    );

    private static String graftTemplate;

    private RemoteBridgePatch() {
    }

    public static void attach(Bridge bridge) {
        if (bridge == null) return;
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                try {
                    bridge.eval(buildGraft(bridge), null);
                } catch (Exception ignored) {
                    /* a missing graft must never break page loads */
                }
            }
        });
    }

    private static String buildGraft(Bridge bridge) throws Exception {
        if (graftTemplate == null) {
            graftTemplate = readAsset(bridge, "remote-bridge-graft.js");
        }
        JSONArray headers = new JSONArray();
        for (String id : PLUGIN_IDS) {
            try {
                PluginHandle handle = bridge.getPlugin(id);
                if (handle == null) continue;
                JSONObject header = new JSONObject();
                header.put("name", handle.getId());
                JSONArray methods = new JSONArray();
                for (PluginMethodHandle method : handle.getMethods()) {
                    JSONObject m = new JSONObject();
                    m.put("name", method.getName());
                    if (!"none".equals(method.getReturnType())) {
                        m.put("rtype", method.getReturnType());
                    }
                    methods.put(m);
                }
                header.put("methods", methods);
                headers.put(header);
            } catch (Exception ignored) {
                /* one bad plugin must not sink the rest */
            }
        }
        return graftTemplate.replace("__PLUGIN_HEADERS__", headers.toString());
    }

    private static String readAsset(Bridge bridge, String name) throws Exception {
        InputStream in = bridge.getContext().getAssets().open(name);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            try {
                in.close();
            } catch (Exception ignored) {
            }
        }
    }
}
