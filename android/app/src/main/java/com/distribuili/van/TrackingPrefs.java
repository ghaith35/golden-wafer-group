package com.distribuili.van;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/// Settings + the offline position queue of the always-on location service.
/// Plain SharedPreferences (no WebView / JS needed): the service must keep
/// working after the app UI is closed, killed, or the phone rebooted.
final class TrackingPrefs {
    private static final String FILE = "dili_tracking";
    private static final int QUEUE_CAP = 800;

    private final SharedPreferences sp;

    TrackingPrefs(Context c) {
        sp = c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    boolean enabled() {
        return sp.getBoolean("enabled", false);
    }

    String baseUrl() {
        return sp.getString("baseUrl", "");
    }

    String deviceToken() {
        return sp.getString("deviceToken", "");
    }

    void save(String baseUrl, String deviceToken, boolean enabled) {
        sp.edit().putString("baseUrl", baseUrl).putString("deviceToken", deviceToken).putBoolean("enabled", enabled).apply();
    }

    void disable() {
        sp.edit().putBoolean("enabled", false).apply();
    }

    long lastReportAt() {
        return sp.getLong("lastReportAt", 0L);
    }

    void setLastReportAt(long t) {
        sp.edit().putLong("lastReportAt", t).apply();
    }

    String lastError() {
        return sp.getString("lastError", "");
    }

    void setLastError(String e) {
        sp.edit().putString("lastError", e == null ? "" : e).apply();
    }

    // ── offline queue (JSON array of {lat,lng,accuracy,speed,t}) ──────────

    synchronized JSONArray queue() {
        try {
            return new JSONArray(sp.getString("queue", "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    synchronized int queueSize() {
        return queue().length();
    }

    synchronized void push(JSONObject position) {
        JSONArray q = queue();
        q.put(position);
        // Oldest points are dropped first when a phone has been offline for very long.
        if (q.length() > QUEUE_CAP) {
            JSONArray trimmed = new JSONArray();
            for (int i = q.length() - QUEUE_CAP; i < q.length(); i++) trimmed.put(q.opt(i));
            q = trimmed;
        }
        sp.edit().putString("queue", q.toString()).apply();
    }

    /// Remove the first `n` queued points (after the server confirmed them).
    synchronized void drop(int n) {
        JSONArray q = queue();
        JSONArray rest = new JSONArray();
        for (int i = n; i < q.length(); i++) rest.put(q.opt(i));
        sp.edit().putString("queue", rest.toString()).apply();
    }
}
