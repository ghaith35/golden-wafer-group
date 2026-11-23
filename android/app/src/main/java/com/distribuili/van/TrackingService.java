package com.distribuili.van;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/// Always-on location service of the van phone (Android foreground service).
///
/// Every POLL_MS it asks the server "does the office want my position now?" —
/// a tiny request — and answers within seconds with a fresh GPS fix, even when
/// the app UI is closed. Independently it sends the position every REPORT_MS.
/// Fixes taken while there is no signal are queued on the phone and uploaded
/// in one batch when the connection returns. Runs again after a reboot or an
/// app update (BootReceiver) and is restarted by Android if it kills it.
public class TrackingService extends Service {
    static final String CHANNEL = "dili_tracking";
    static final int NOTIF_ID = 4711;
    static final long POLL_MS = 15_000;
    static final long REPORT_MS = 90_000;
    private static final int HTTP_TIMEOUT_MS = 10_000;
    private static final long FIX_TIMEOUT_MS = 15_000;
    private static final int BATCH = 200;
    static final String APP_VERSION = "1.20";

    private ScheduledExecutorService pool;
    private PowerManager.WakeLock wake;
    private TrackingPrefs prefs;
    private volatile boolean stopping = false;

    // ───────────────────────── lifecycle ─────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = new TrackingPrefs(this);
        ensureChannel();
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Exception e) {
            // Android refused a foreground start (e.g. permission just revoked): stop quietly.
            stopSelf();
            return;
        }
        pool = Executors.newSingleThreadScheduledExecutor();
        // First cycle shortly after start, then a steady beat.
        pool.scheduleWithFixedDelay(this::safeCycle, 2, POLL_MS / 1000, TimeUnit.SECONDS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!prefs.enabled()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // Sticky: Android recreates the service if it ever kills the process.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopping = true;
        if (pool != null) pool.shutdownNow();
        releaseWake();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ───────────────────────── notification ──────────────────────────────

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, channelName(), NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        ch.setSound(null, null);
        nm.createNotificationChannel(ch);
    }

    private static String lang() {
        return Locale.getDefault().getLanguage();
    }

    private String channelName() {
        switch (lang()) {
            case "ar": return "تتبع الموقع";
            case "fr": return "Suivi de position";
            default: return "Location tracking";
        }
    }

    private String notifText() {
        switch (lang()) {
            case "ar": return "تتبع موقع الشاحنة نشط";
            case "fr": return "Suivi de position du camion actif";
            default: return "Van location tracking is active";
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Golden Wafer")
            .setContentText(notifText())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(pi)
            .build();
    }

    // ───────────────────────── the beat ──────────────────────────────────

    private void safeCycle() {
        if (stopping) return;
        acquireWake();
        try {
            cycle();
        } catch (Throwable t) {
            prefs.setLastError("cycle: " + t.getClass().getSimpleName());
        } finally {
            releaseWake();
        }
    }

    private void cycle() throws Exception {
        if (!prefs.enabled() || prefs.baseUrl().isEmpty() || prefs.deviceToken().isEmpty()) {
            stopSelf();
            return;
        }
        long now = System.currentTimeMillis();
        boolean due = now - prefs.lastReportAt() >= REPORT_MS;
        boolean wanted = false;
        if (!due) {
            // Cheap question first: only power the GPS when there is a reason.
            Boolean w = pollPending();
            wanted = w != null && w;
        }
        if (due || wanted) {
            Location fix = fix();
            if (fix != null) prefs.push(toJson(fix));
            // Upload whatever is queued (this fix + anything saved while offline).
            flush();
            if (fix != null) prefs.setLastReportAt(System.currentTimeMillis());
            else reportState(); // no fix (GPS off / no signal): the office still learns why
        } else if (prefs.queueSize() > 0) {
            // Signal may be back: drain the offline queue without waiting.
            flush();
        }
    }

    private static JSONObject toJson(Location l) throws Exception {
        JSONObject o = new JSONObject();
        o.put("lat", l.getLatitude());
        o.put("lng", l.getLongitude());
        if (l.hasAccuracy()) o.put("accuracy", Math.round(l.getAccuracy()));
        if (l.hasSpeed() && l.getSpeed() >= 0) o.put("speed", Math.round(l.getSpeed() * 3.6 * 10.0) / 10.0);
        o.put("t", l.getTime() > 0 ? l.getTime() : System.currentTimeMillis());
        return o;
    }

    // ───────────────────────── GPS fix ───────────────────────────────────

    private boolean hasFine() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /// One fresh fix (≤ FIX_TIMEOUT_MS), preferring GPS, falling back to the
    /// network provider, then to a recent last-known position. Null = none.
    @SuppressWarnings("deprecation")
    private Location fix() {
        if (!hasFine()) {
            prefs.setLastError("no_permission");
            return null;
        }
        LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return null;
        String[] providers = new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER };
        for (String provider : providers) {
            try {
                if (!lm.isProviderEnabled(provider)) continue;
                Location l = singleFix(lm, provider);
                if (l != null) {
                    prefs.setLastError("");
                    return l;
                }
            } catch (SecurityException se) {
                prefs.setLastError("no_permission");
                return null;
            } catch (Exception ignored) {
                /* try the next provider */
            }
        }
        // Last resort: a position taken in the last 3 minutes.
        try {
            for (String provider : providers) {
                Location last = lm.getLastKnownLocation(provider);
                if (last != null && System.currentTimeMillis() - last.getTime() < 180_000) return last;
            }
        } catch (Exception ignored) {
            /* none */
        }
        prefs.setLastError("no_fix");
        return null;
    }

    @SuppressWarnings("deprecation")
    private Location singleFix(LocationManager lm, String provider) throws Exception {
        final AtomicReference<Location> out = new AtomicReference<>();
        final CountDownLatch latch = new CountDownLatch(1);
        if (Build.VERSION.SDK_INT >= 30) {
            CancellationSignal cancel = new CancellationSignal();
            lm.getCurrentLocation(provider, cancel, ContextCompat.getMainExecutor(this), loc -> {
                out.set(loc);
                latch.countDown();
            });
            if (!latch.await(FIX_TIMEOUT_MS, TimeUnit.MILLISECONDS)) cancel.cancel();
        } else {
            final LocationListener listener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    out.set(location);
                    latch.countDown();
                }

                @Override
                public void onProviderEnabled(String p) {}

                @Override
                public void onProviderDisabled(String p) {}

                @Override
                @SuppressWarnings("deprecation")
                public void onStatusChanged(String p, int s, android.os.Bundle e) {}
            };
            lm.requestSingleUpdate(provider, listener, Looper.getMainLooper());
            if (!latch.await(FIX_TIMEOUT_MS, TimeUnit.MILLISECONDS)) lm.removeUpdates(listener);
        }
        return out.get();
    }

    // ───────────────────────── network ───────────────────────────────────

    private JSONObject post(String path, JSONObject body) throws Exception {
        String base = prefs.baseUrl();
        if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        HttpURLConnection c = (HttpURLConnection) new URL(base + path).openConnection();
        try {
            c.setRequestMethod("POST");
            c.setConnectTimeout(HTTP_TIMEOUT_MS);
            c.setReadTimeout(HTTP_TIMEOUT_MS);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = c.getOutputStream()) {
                os.write(bytes);
            }
            int code = c.getResponseCode();
            if (code == 401) {
                prefs.setLastError("unauthorized");
                return null;
            }
            if (code < 200 || code >= 300) {
                prefs.setLastError("http_" + code);
                return null;
            }
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            }
            return new JSONObject(sb.toString());
        } finally {
            c.disconnect();
        }
    }

    /// "Does the office want my position?" — null when the server is unreachable.
    private Boolean pollPending() {
        try {
            JSONObject b = new JSONObject();
            b.put("deviceToken", prefs.deviceToken());
            JSONObject r = post("/api/track/pending", b);
            if (r == null) return null;
            return r.optBoolean("locateRequested", false);
        } catch (Exception e) {
            return null;
        }
    }

    /// Upload the queued fixes in batches of BATCH; stops at the first failure
    /// (the rest stays queued and goes out on the next beat).
    private void flush() {
        try {
            while (true) {
                JSONArray q = prefs.queue();
                if (q.length() == 0) {
                    // Nothing queued: still tell the office how healthy tracking is.
                    break;
                }
                int n = Math.min(BATCH, q.length());
                JSONArray part = new JSONArray();
                for (int i = 0; i < n; i++) part.put(q.get(i));
                JSONObject b = new JSONObject();
                b.put("deviceToken", prefs.deviceToken());
                b.put("positions", part);
                b.put("state", state());
                JSONObject r = post("/api/track/batch", b);
                if (r == null) return; // offline / refused: keep the queue
                prefs.drop(n);
                if (n < BATCH) break;
            }
        } catch (Exception e) {
            /* keep the queue for the next beat */
        }
    }

    /// A heartbeat with no position, only the health report.
    private void reportState() {
        try {
            JSONObject b = new JSONObject();
            b.put("deviceToken", prefs.deviceToken());
            b.put("positions", new JSONArray());
            b.put("state", state());
            post("/api/track/batch", b);
        } catch (Exception ignored) {
            /* next beat */
        }
    }

    /// The phone's own health report (permissions, battery…) for the office.
    private JSONObject state() throws Exception {
        JSONObject s = new JSONObject();
        s.put("fine", hasFine());
        boolean always = Build.VERSION.SDK_INT < 29
            || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
        s.put("always", always);
        s.put("notifications", NotificationManagerCompat.from(this).areNotificationsEnabled());
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        s.put("battery", pm != null && Build.VERSION.SDK_INT >= 23 && pm.isIgnoringBatteryOptimizations(getPackageName()));
        s.put("service", true);
        try {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            boolean on = lm != null && (Build.VERSION.SDK_INT >= 28 ? lm.isLocationEnabled()
                : lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
            s.put("gps", on);
        } catch (Exception ignored) {
            /* unknown */
        }
        s.put("queued", prefs.queueSize());
        s.put("app", APP_VERSION);
        return s;
    }

    // ───────────────────────── wake lock ─────────────────────────────────

    private void acquireWake() {
        try {
            if (wake == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm == null) return;
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GoldenWafer:tracking");
                wake.setReferenceCounted(false);
            }
            // Held only for one beat (the fix + the request), never for long.
            wake.acquire(40_000);
        } catch (Exception ignored) {
            /* the beat still runs without it */
        }
    }

    private void releaseWake() {
        try {
            if (wake != null && wake.isHeld()) wake.release();
        } catch (Exception ignored) {
            /* already released */
        }
    }
}
