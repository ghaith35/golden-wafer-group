package com.distribuili.van;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/// The web app's handle on the always-on location service: permission steps,
/// battery exemption, start / stop and a status snapshot. Everything is
/// answered synchronously or via one permission callback — no plugin events,
/// so it behaves the same on local pages and on remote pages
/// (RemoteBridgePatch). Errors reject with a bare CODE as the message.
@CapacitorPlugin(
    name = "VanTracking",
    permissions = {
        @Permission(alias = "fine", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notif", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class VanTracking extends Plugin {

    private boolean granted(String p) {
        return ContextCompat.checkSelfPermission(getContext(), p) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean fine() {
        return granted(Manifest.permission.ACCESS_FINE_LOCATION);
    }

    private boolean always() {
        return Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    private boolean notifications() {
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }

    private boolean battery() {
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            return Build.VERSION.SDK_INT < 23 || (pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        } catch (Exception e) {
            return false;
        }
    }

    private boolean gpsOn() {
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return true;
            if (Build.VERSION.SDK_INT >= 28) return lm.isLocationEnabled();
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) {
            return true;
        }
    }

    private boolean serviceEnabled() {
        return new TrackingPrefs(getContext()).enabled();
    }

    private JSObject snapshot() {
        TrackingPrefs prefs = new TrackingPrefs(getContext());
        JSObject o = new JSObject();
        o.put("available", true);
        o.put("sdk", Build.VERSION.SDK_INT);
        o.put("fine", fine());
        o.put("always", always());
        o.put("notifications", notifications());
        o.put("battery", battery());
        o.put("gps", gpsOn());
        o.put("enabled", prefs.enabled());
        o.put("lastReportAt", prefs.lastReportAt());
        o.put("lastError", prefs.lastError());
        o.put("queued", prefs.queueSize());
        o.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(snapshot());
    }

    /// Step 1: the normal runtime dialog for precise location.
    @PluginMethod
    public void requestFine(PluginCall call) {
        if (fine()) {
            call.resolve(snapshot());
            return;
        }
        requestPermissionForAlias("fine", call, "afterPermission");
    }

    /// Step 3 (Android 13+): notification permission (the service notification).
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || notifications()) {
            call.resolve(snapshot());
            return;
        }
        requestPermissionForAlias("notif", call, "afterPermission");
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        call.resolve(snapshot());
    }

    /// Step 2: "Allow all the time". Android 10 shows a dialog; Android 11+
    /// only allows it from the app's settings page, so we open that page.
    @PluginMethod
    public void requestAlways(PluginCall call) {
        if (always()) {
            call.resolve(snapshot());
            return;
        }
        try {
            openAppSettingsInternal();
            call.resolve(snapshot());
        } catch (Exception e) {
            call.reject("settings_failed");
        }
    }

    /// Step 4: take the app off Android's battery optimisation.
    @PluginMethod
    public void requestBattery(PluginCall call) {
        if (battery()) {
            call.resolve(snapshot());
            return;
        }
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            try {
                Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } catch (Exception e2) {
                call.reject("settings_failed");
                return;
            }
        }
        call.resolve(snapshot());
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            openAppSettingsInternal();
            call.resolve(snapshot());
        } catch (Exception e) {
            call.reject("settings_failed");
        }
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(snapshot());
        } catch (Exception e) {
            call.reject("settings_failed");
        }
    }

    private void openAppSettingsInternal() {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
    }

    /// Save the server + device token and start the always-on service. Safe to
    /// call on every app launch (idempotent).
    @PluginMethod
    public void start(PluginCall call) {
        String baseUrl = call.getString("baseUrl", "");
        String token = call.getString("deviceToken", "");
        if (baseUrl == null || baseUrl.isEmpty() || token == null || token.length() < 8) {
            call.reject("bad_args");
            return;
        }
        if (!fine()) {
            call.reject("no_permission");
            return;
        }
        new TrackingPrefs(getContext()).save(baseUrl, token, true);
        try {
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), TrackingService.class));
        } catch (Exception e) {
            call.reject("start_failed");
            return;
        }
        call.resolve(snapshot());
    }

    /// Stop tracking (used on logout / unpairing).
    @PluginMethod
    public void stop(PluginCall call) {
        new TrackingPrefs(getContext()).disable();
        try {
            getContext().stopService(new Intent(getContext(), TrackingService.class));
        } catch (Exception ignored) {
            /* already stopped */
        }
        call.resolve(snapshot());
    }
}
