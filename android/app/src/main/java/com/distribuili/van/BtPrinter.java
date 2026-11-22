package com.distribuili.van;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/// Direct Bluetooth thermal printing (ESC/POS) for the van phone — no system
/// print dialog. The WEB side renders the ticket to a raster image and builds
/// the complete ESC/POS byte stream; this plugin is a dumb, robust pipe:
/// permissions, enable Bluetooth, find/pair printers, write bytes.
///
/// Transports: classic Bluetooth SPP (RFCOMM — most Xprinter models) and BLE
/// GATT (BLE-only models). Errors reject with a bare CODE as the message
/// (remote pages lose error.code through the bridge graft):
///   no_permission · bt_off · bt_unsupported · bad_args · not_found · busy
///   connect_failed · write_failed · pair_failed · pair_timeout · cancelled
///
/// Discovery is POLLED (getDiscovered) instead of using plugin events, so it
/// works identically on local pages and on remote pages (RemoteBridgePatch).
@CapacitorPlugin(
    name = "BtPrinter",
    permissions = {
        @Permission(
            alias = "bt12",
            strings = { "android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT" }
        ),
        @Permission(alias = "btLegacy", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class BtPrinter extends Plugin {

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int CLASSIC_CHUNK = 512;
    private static final int CLASSIC_PACE_MS = 6;
    private static final long SCAN_MS = 12_000;
    private static final long PAIR_TIMEOUT_MS = 60_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);

    // ── discovery state ────────────────────────────────────────────────────
    private final Map<String, JSObject> found = new LinkedHashMap<>();
    private BroadcastReceiver discoveryReceiver;
    private ScanCallback leCallback;
    private volatile boolean scanning = false;
    private Runnable scanStop;

    // ── pairing state ──────────────────────────────────────────────────────
    private BroadcastReceiver bondReceiver;
    private Runnable bondTimeout;

    // ── write state (cancel support) ───────────────────────────────────────
    private volatile BluetoothSocket currentSocket;
    private volatile BluetoothGatt currentGatt;
    private volatile boolean cancelled = false;
    private volatile String usedTransport = "";

    // ───────────────────────────── helpers ─────────────────────────────────

    private BluetoothAdapter adapter() {
        try {
            BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
            return m != null ? m.getAdapter() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean granted(String p) {
        return ContextCompat.checkSelfPermission(getContext(), p) == PackageManager.PERMISSION_GRANTED;
    }

    /// Android 12+: BLUETOOTH_SCAN + BLUETOOTH_CONNECT. Android ≤11: the
    /// install-time BLUETOOTH perms cover connecting, but DISCOVERY needs
    /// location — so location is the gate there.
    private boolean hasPerms() {
        if (Build.VERSION.SDK_INT >= 31) {
            return granted("android.permission.BLUETOOTH_SCAN") && granted("android.permission.BLUETOOTH_CONNECT");
        }
        return granted(Manifest.permission.ACCESS_FINE_LOCATION);
    }

    private boolean locationOn() {
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return true;
            if (Build.VERSION.SDK_INT >= 28) return lm.isLocationEnabled();
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) {
            return true;
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences("btprinter", Context.MODE_PRIVATE);
    }

    private boolean permanentlyDenied() {
        if (hasPerms() || !prefs().getBoolean("asked", false) || getActivity() == null) return false;
        String[] perms = Build.VERSION.SDK_INT >= 31
            ? new String[] { "android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT" }
            : new String[] { Manifest.permission.ACCESS_FINE_LOCATION };
        for (String p : perms) {
            if (!granted(p) && ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), p)) return false;
        }
        return true;
    }

    private JSObject stateObj() {
        JSObject o = new JSObject();
        BluetoothAdapter a = adapter();
        boolean supported = a != null && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH);
        o.put("supported", supported);
        boolean enabled = false;
        try {
            enabled = a != null && a.isEnabled();
        } catch (Exception ignored) {
        }
        o.put("enabled", enabled);
        o.put("permission", hasPerms());
        o.put("permanentlyDenied", permanentlyDenied());
        o.put("locationNeeded", Build.VERSION.SDK_INT <= 30);
        o.put("locationOn", locationOn());
        o.put("sdk", Build.VERSION.SDK_INT);
        return o;
    }

    private JSObject deviceJson(BluetoothDevice d) {
        JSObject o = new JSObject();
        String name = null;
        int type = 0;
        int major = 0;
        boolean bonded = false;
        try {
            name = d.getName();
            type = d.getType();
            bonded = d.getBondState() == BluetoothDevice.BOND_BONDED;
            if (d.getBluetoothClass() != null) major = d.getBluetoothClass().getMajorDeviceClass();
        } catch (SecurityException ignored) {
        }
        o.put("address", d.getAddress());
        o.put("name", name == null ? "" : name);
        o.put("type", type); // 1 classic · 2 LE · 3 dual
        o.put("major", major); // 0x600 = imaging (printers)
        o.put("bonded", bonded);
        return o;
    }

    private void putFound(BluetoothDevice d, int rssi, boolean viaLe) {
        if (d == null || d.getAddress() == null) return;
        synchronized (found) {
            JSObject prev = found.get(d.getAddress());
            JSObject cur = deviceJson(d);
            try {
                if (prev != null) {
                    if (cur.optString("name", "").isEmpty()) cur.put("name", prev.optString("name", ""));
                    if (prev.optBoolean("le", false)) cur.put("le", true);
                    if (prev.optBoolean("classic", false)) cur.put("classic", true);
                }
                cur.put(viaLe ? "le" : "classic", true);
                if (rssi != Integer.MIN_VALUE) cur.put("rssi", rssi);
            } catch (Exception ignored) {
            }
            found.put(d.getAddress(), cur);
        }
    }

    // ───────────────────────────── state / permissions ─────────────────────

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(stateObj());
    }

    @PluginMethod
    public void requestBt(PluginCall call) {
        if (hasPerms()) {
            call.resolve(stateObj());
            return;
        }
        prefs().edit().putBoolean("asked", true).apply();
        requestPermissionForAlias(Build.VERSION.SDK_INT >= 31 ? "bt12" : "btLegacy", call, "permResult");
    }

    @PermissionCallback
    private void permResult(PluginCall call) {
        call.resolve(stateObj());
    }

    @PluginMethod
    public void enableBt(PluginCall call) {
        try {
            startActivityForResult(call, new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), "enableResult");
        } catch (Exception e) {
            call.reject("no_permission");
        }
    }

    @ActivityCallback
    private void enableResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        call.resolve(stateObj());
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("bad_args");
        }
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("bad_args");
        }
    }

    // ───────────────────────────── paired + discovery ──────────────────────

    @PluginMethod
    public void bonded(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) {
            call.reject("bt_unsupported");
            return;
        }
        if (!hasPerms()) {
            call.reject("no_permission");
            return;
        }
        try {
            JSArray arr = new JSArray();
            Set<BluetoothDevice> set = a.getBondedDevices();
            if (set != null) for (BluetoothDevice d : set) arr.put(deviceJson(d));
            JSObject o = new JSObject();
            o.put("devices", arr);
            call.resolve(o);
        } catch (SecurityException e) {
            call.reject("no_permission");
        }
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) {
            call.reject("bt_unsupported");
            return;
        }
        if (!hasPerms()) {
            call.reject("no_permission");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("bt_off");
            return;
        }
        stopDiscoveryInternal();
        synchronized (found) {
            found.clear();
        }
        try {
            discoveryReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent intent) {
                    String action = intent.getAction();
                    if (BluetoothDevice.ACTION_FOUND.equals(action) || BluetoothDevice.ACTION_NAME_CHANGED.equals(action)) {
                        BluetoothDevice d = extraDevice(intent);
                        int rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE);
                        putFound(d, rssi == Short.MIN_VALUE ? Integer.MIN_VALUE : rssi, false);
                    }
                }
            };
            IntentFilter f = new IntentFilter();
            f.addAction(BluetoothDevice.ACTION_FOUND);
            f.addAction(BluetoothDevice.ACTION_NAME_CHANGED);
            ContextCompat.registerReceiver(getContext(), discoveryReceiver, f, ContextCompat.RECEIVER_EXPORTED);
            try {
                a.startDiscovery();
            } catch (SecurityException ignored) {
            }
            // BLE-only printers never show up in classic discovery.
            try {
                BluetoothLeScanner le = a.getBluetoothLeScanner();
                if (le != null) {
                    leCallback = new ScanCallback() {
                        @Override
                        public void onScanResult(int callbackType, ScanResult r) {
                            putFound(r.getDevice(), r.getRssi(), true);
                        }

                        @Override
                        public void onBatchScanResults(List<ScanResult> results) {
                            for (ScanResult r : results) putFound(r.getDevice(), r.getRssi(), true);
                        }
                    };
                    le.startScan(leCallback);
                }
            } catch (Exception ignored) {
                leCallback = null;
            }
            scanning = true;
            scanStop = () -> stopDiscoveryInternal();
            main.postDelayed(scanStop, SCAN_MS);
            call.resolve();
        } catch (Exception e) {
            stopDiscoveryInternal();
            call.reject("no_permission");
        }
    }

    @SuppressWarnings("deprecation")
    private BluetoothDevice extraDevice(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) {
            return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
        }
        return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
    }

    private void stopDiscoveryInternal() {
        scanning = false;
        if (scanStop != null) {
            main.removeCallbacks(scanStop);
            scanStop = null;
        }
        BluetoothAdapter a = adapter();
        try {
            if (a != null && a.isDiscovering()) a.cancelDiscovery();
        } catch (Exception ignored) {
        }
        try {
            if (a != null && leCallback != null) {
                BluetoothLeScanner le = a.getBluetoothLeScanner();
                if (le != null) le.stopScan(leCallback);
            }
        } catch (Exception ignored) {
        }
        leCallback = null;
        if (discoveryReceiver != null) {
            try {
                getContext().unregisterReceiver(discoveryReceiver);
            } catch (Exception ignored) {
            }
            discoveryReceiver = null;
        }
    }

    @PluginMethod
    public void getDiscovered(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (found) {
            for (JSObject d : found.values()) arr.put(d);
        }
        JSObject o = new JSObject();
        o.put("devices", arr);
        o.put("scanning", scanning);
        call.resolve(o);
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        stopDiscoveryInternal();
        call.resolve();
    }

    // ───────────────────────────── pairing ─────────────────────────────────

    @PluginMethod
    public void pair(final PluginCall call) {
        final String address = call.getString("address");
        BluetoothAdapter a = adapter();
        if (address == null || a == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("bad_args");
            return;
        }
        if (!hasPerms()) {
            call.reject("no_permission");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("bt_off");
            return;
        }
        try {
            final BluetoothDevice d = a.getRemoteDevice(address);
            if (d.getBondState() == BluetoothDevice.BOND_BONDED) {
                call.resolve();
                return;
            }
            stopDiscoveryInternal();
            clearBondWatch();
            final AtomicBoolean sawBonding = new AtomicBoolean(d.getBondState() == BluetoothDevice.BOND_BONDING);
            bondReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent intent) {
                    BluetoothDevice dev = extraDevice(intent);
                    if (dev == null || !address.equalsIgnoreCase(dev.getAddress())) return;
                    int st = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR);
                    if (st == BluetoothDevice.BOND_BONDING) sawBonding.set(true);
                    if (st == BluetoothDevice.BOND_BONDED) {
                        clearBondWatch();
                        call.resolve();
                    } else if (st == BluetoothDevice.BOND_NONE && sawBonding.get()) {
                        clearBondWatch();
                        call.reject("pair_failed");
                    }
                }
            };
            ContextCompat.registerReceiver(
                getContext(),
                bondReceiver,
                new IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED),
                ContextCompat.RECEIVER_EXPORTED
            );
            bondTimeout = () -> {
                clearBondWatch();
                call.reject("pair_timeout");
            };
            main.postDelayed(bondTimeout, PAIR_TIMEOUT_MS);
            if (!d.createBond()) {
                clearBondWatch();
                call.reject("pair_failed");
            }
        } catch (SecurityException e) {
            clearBondWatch();
            call.reject("no_permission");
        } catch (Exception e) {
            clearBondWatch();
            call.reject("pair_failed");
        }
    }

    private void clearBondWatch() {
        if (bondTimeout != null) {
            main.removeCallbacks(bondTimeout);
            bondTimeout = null;
        }
        if (bondReceiver != null) {
            try {
                getContext().unregisterReceiver(bondReceiver);
            } catch (Exception ignored) {
            }
            bondReceiver = null;
        }
    }

    // ───────────────────────────── writing ─────────────────────────────────

    @PluginMethod
    public void write(final PluginCall call) {
        final String address = call.getString("address");
        final String b64 = call.getString("data");
        final String hint = call.getString("transport");
        BluetoothAdapter a = adapter();
        if (address == null || b64 == null || b64.isEmpty() || a == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("bad_args");
            return;
        }
        if (!hasPerms()) {
            call.reject("no_permission");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("bt_off");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("busy");
            return;
        }
        cancelled = false;
        io.execute(() -> {
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                stopDiscoveryInternal();
                BluetoothDevice device = a.getRemoteDevice(address);
                String err = doWrite(device, data, hint);
                if (err == null) {
                    JSObject o = new JSObject();
                    o.put("bytes", data.length);
                    o.put("transport", usedTransport);
                    call.resolve(o);
                } else {
                    call.reject(err);
                }
            } catch (SecurityException e) {
                call.reject("no_permission");
            } catch (Exception e) {
                call.reject("write_failed");
            } finally {
                busy.set(false);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        try {
            BluetoothSocket s = currentSocket;
            if (s != null) s.close();
        } catch (Exception ignored) {
        }
        try {
            BluetoothGatt g = currentGatt;
            if (g != null) g.disconnect();
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    /// Returns null on success, else an error code. Falls back to the other
    /// transport ONLY when the connection never opened (nothing was sent), so
    /// a ticket can never print twice.
    private String doWrite(BluetoothDevice device, byte[] data, String hint) {
        int type = BluetoothDevice.DEVICE_TYPE_UNKNOWN;
        try {
            type = device.getType();
        } catch (SecurityException ignored) {
        }
        List<String> order = new ArrayList<>();
        if ("ble".equals(hint)) {
            order.add("ble");
            order.add("classic");
        } else if ("classic".equals(hint)) {
            order.add("classic");
            order.add("ble");
        } else if (type == BluetoothDevice.DEVICE_TYPE_LE) {
            order.add("ble");
            order.add("classic");
        } else {
            order.add("classic");
            order.add("ble");
        }
        String first = null;
        for (String t : order) {
            if (cancelled) return "cancelled";
            String e = "classic".equals(t) ? writeClassic(device, data) : writeBle(device, data);
            if (e == null) {
                usedTransport = t;
                return null;
            }
            if (first == null) first = e;
            if (!"connect_failed".equals(e)) return e; // partial data may be out — never retry
        }
        return first == null ? "connect_failed" : first;
    }

    private String writeClassic(BluetoothDevice device, byte[] data) {
        BluetoothSocket s = null;
        try {
            // 1) secure SPP  2) insecure SPP  3) legacy reflection (cheap clones)
            for (int attempt = 0; attempt < 3 && s == null; attempt++) {
                if (cancelled) return "cancelled";
                BluetoothSocket cand = null;
                try {
                    if (attempt == 0) cand = device.createRfcommSocketToServiceRecord(SPP);
                    else if (attempt == 1) cand = device.createInsecureRfcommSocketToServiceRecord(SPP);
                    else {
                        Method m = device.getClass().getMethod("createRfcommSocket", int.class);
                        cand = (BluetoothSocket) m.invoke(device, 1);
                    }
                    currentSocket = cand;
                    cand.connect();
                    s = cand;
                } catch (SecurityException se) {
                    closeQuietly(cand);
                    return "no_permission";
                } catch (Exception e) {
                    closeQuietly(cand);
                    if (cancelled) return "cancelled";
                    sleep(350);
                }
            }
            if (s == null) return "connect_failed";
            OutputStream out = s.getOutputStream();
            int off = 0;
            while (off < data.length) {
                if (cancelled) return "cancelled";
                int n = Math.min(CLASSIC_CHUNK, data.length - off);
                out.write(data, off, n);
                out.flush();
                off += n;
                sleep(CLASSIC_PACE_MS);
            }
            out.flush();
            sleep(700); // let the printer drain its buffer before the link drops
            return null;
        } catch (IOException e) {
            return cancelled ? "cancelled" : "write_failed";
        } finally {
            closeQuietly(s);
            currentSocket = null;
        }
    }

    private void closeQuietly(BluetoothSocket s) {
        if (s == null) return;
        try {
            s.close();
        } catch (Exception ignored) {
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    // ── BLE GATT ───────────────────────────────────────────────────────────

    private static class GattState {
        final CountDownLatch ready = new CountDownLatch(1);
        final CountDownLatch mtuDone = new CountDownLatch(1);
        final Semaphore writeSlot = new Semaphore(0);
        volatile boolean connected = false;
        volatile boolean failed = false;
        volatile int mtu = 23;
        volatile BluetoothGattCharacteristic ch;
    }

    @SuppressWarnings("deprecation")
    private String writeBle(BluetoothDevice device, byte[] data) {
        final GattState st = new GattState();
        BluetoothGatt gatt = null;
        try {
            final BluetoothGattCallback cb = new BluetoothGattCallback() {
                @Override
                public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
                    if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                        st.connected = true;
                        try {
                            if (!g.requestMtu(185)) st.mtuDone.countDown();
                        } catch (SecurityException e) {
                            st.failed = true;
                            st.ready.countDown();
                            st.mtuDone.countDown();
                        }
                    } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                        st.failed = true;
                        st.ready.countDown();
                        st.mtuDone.countDown();
                        st.writeSlot.release();
                    }
                }

                @Override
                public void onMtuChanged(BluetoothGatt g, int mtu, int status) {
                    if (status == BluetoothGatt.GATT_SUCCESS) st.mtu = mtu;
                    st.mtuDone.countDown();
                    try {
                        g.discoverServices();
                    } catch (SecurityException e) {
                        st.failed = true;
                        st.ready.countDown();
                    }
                }

                @Override
                public void onServicesDiscovered(BluetoothGatt g, int status) {
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        st.ch = pickWritable(g);
                    }
                    if (st.ch == null) st.failed = true;
                    st.ready.countDown();
                }

                @Override
                public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
                    if (status != BluetoothGatt.GATT_SUCCESS) st.failed = true;
                    st.writeSlot.release();
                }
            };
            gatt = Build.VERSION.SDK_INT >= 23
                ? device.connectGatt(getContext(), false, cb, BluetoothDevice.TRANSPORT_LE)
                : device.connectGatt(getContext(), false, cb);
            currentGatt = gatt;
            if (gatt == null) return "connect_failed";
            // If MTU negotiation silently never answers, still discover services.
            if (!st.mtuDone.await(4, TimeUnit.SECONDS)) {
                try {
                    gatt.discoverServices();
                } catch (SecurityException ignored) {
                }
            }
            if (!st.ready.await(12, TimeUnit.SECONDS) || st.failed || st.ch == null) {
                return cancelled ? "cancelled" : "connect_failed";
            }
            final BluetoothGattCharacteristic ch = st.ch;
            final boolean noResp = (ch.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
            ch.setWriteType(noResp ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            final int chunk = Math.max(20, Math.min(st.mtu - 3, 180));
            int off = 0;
            while (off < data.length) {
                if (cancelled) return "cancelled";
                int n = Math.min(chunk, data.length - off);
                byte[] part = new byte[n];
                System.arraycopy(data, off, part, 0, n);
                ch.setValue(part);
                st.writeSlot.drainPermits();
                if (!gatt.writeCharacteristic(ch)) {
                    sleep(30); // stack busy — one retry
                    if (!gatt.writeCharacteristic(ch)) return "write_failed";
                }
                if (!st.writeSlot.tryAcquire(3, TimeUnit.SECONDS) || st.failed) return "write_failed";
                off += n;
                sleep(4);
            }
            sleep(700);
            return null;
        } catch (SecurityException e) {
            return "no_permission";
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return "write_failed";
        } catch (Exception e) {
            return "write_failed";
        } finally {
            currentGatt = null;
            if (gatt != null) {
                try {
                    gatt.disconnect();
                } catch (Exception ignored) {
                }
                try {
                    gatt.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    /// Prefer a WRITE_NO_RESPONSE characteristic (printer data channel, e.g.
    /// service FF00/FFE0/18F0/49535343…), else any WRITE one. Skips the
    /// generic GAP/GATT services.
    private static BluetoothGattCharacteristic pickWritable(BluetoothGatt g) {
        BluetoothGattCharacteristic withResp = null;
        for (BluetoothGattService s : g.getServices()) {
            String u = s.getUuid().toString().toLowerCase();
            if (u.startsWith("00001800") || u.startsWith("00001801")) continue;
            for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                int p = c.getProperties();
                if ((p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) return c;
                if (withResp == null && (p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0) withResp = c;
            }
        }
        return withResp;
    }

    @Override
    protected void handleOnDestroy() {
        stopDiscoveryInternal();
        clearBondWatch();
        io.shutdownNow();
    }
}
