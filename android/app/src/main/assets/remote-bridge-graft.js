// Remote-page native bridge graft (evaluated after each full page load).
//
// Why: the native injector only targets the LOCAL launcher origin, so pages
// served from the client's own https servers never receive nativePromise /
// PluginHeaders. Every plugin call from those pages then throws
// "not implemented on android" — even though the androidBridge message
// channel works there. This graft mutates (never replaces) the page's own
// window.Capacitor: local pages already have nativePromise and self-skip.
//
// __PLUGIN_HEADERS__ is substituted at runtime with the real registered
// plugin headers (same shape as the official injector output).
(function () {
  var cap = window.Capacitor;
  if (!cap || cap.nativePromise || !window.androidBridge) return;
  var pending = {};
  var nextId = 1;
  cap.toNative = function (plugin, method, options, stored) {
    try {
      var id = '-1';
      if (
        stored &&
        (typeof stored.callback === 'function' || typeof stored.resolve === 'function')
      ) {
        id = String(nextId++);
        pending[id] = stored;
      }
      window.androidBridge.postMessage(
        JSON.stringify({ callbackId: id, pluginId: plugin, methodName: method, options: options || {} })
      );
      return id;
    } catch (e) {
      return null;
    }
  };
  function settle(result) {
    try {
      var s = pending[result.callbackId];
      var err = null;
      if (result.error) {
        err = new Error((result.error && result.error.message) || 'native_error');
      }
      if (s) {
        if (typeof s.callback === 'function') {
          if (result.success) s.callback(result.data);
          else s.callback(null, err);
        } else if (typeof s.resolve === 'function') {
          if (result.success) s.resolve(result.data);
          else s.reject(err);
          delete pending[result.callbackId];
        }
      }
      if (result.save === false) delete pending[result.callbackId];
    } catch (e) {
      /* never break the host page */
    }
  }
  cap.fromNative = function (result) {
    settle(result);
  };
  try {
    window.androidBridge.onmessage = function (event) {
      try {
        settle(JSON.parse(event.data));
      } catch (e) {
        /* ignore malformed messages */
      }
    };
  } catch (e) {
    /* legacy interface: responses arrive via fromNative */
  }
  cap.nativeCallback = function (plugin, method, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }
    return cap.toNative(plugin, method, options, { callback: callback });
  };
  cap.nativePromise = function (plugin, method, options) {
    return new Promise(function (resolve, reject) {
      cap.toNative(plugin, method, options, { resolve: resolve, reject: reject });
    });
  };
  cap.PluginHeaders = __PLUGIN_HEADERS__;
})();
