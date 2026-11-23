package com.distribuili.van;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/// Restarts the always-on location service after the phone reboots or the app
/// is updated, so tracking never depends on the driver opening the app.
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent == null ? "" : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
        try {
            if (!new TrackingPrefs(context).enabled()) return;
            ContextCompat.startForegroundService(context, new Intent(context, TrackingService.class));
        } catch (Exception ignored) {
            /* Android may refuse a background start; the app restarts it next time it is opened */
        }
    }
}
