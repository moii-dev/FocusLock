(() => {
  'use strict';
  const KEY = Symbol.for('focuslock.controller.v1');
  const CONFIG = Symbol.for('focuslock.config.v1');
  const boot = window[CONFIG];
  delete window[CONFIG];
  if (window[KEY] || !boot) return;

  const native = {
    add: EventTarget.prototype.addEventListener,
    remove: EventTarget.prototype.removeEventListener,
    stop: Event.prototype.stopImmediatePropagation,
    interval: window.setInterval, clearInterval: window.clearInterval,
    clearTimeout: window.clearTimeout,
    now: performance.now.bind(performance),
    hidden: Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')?.get,
    hasFocus: Document.prototype.hasFocus,
    log: console.debug.bind(console), warn: console.warn.bind(console)
  };
  const installation = { version: '1.1.0', source: boot.source || 'document_start', readyState: document.readyState };
  let settings = { enabled: false };
  let returningElement = null;
  const focusEvents = new Set(['blur', 'focus', 'focusin', 'focusout']);
  const patches = new Map();
  const stats = { suppressed: {}, observed: {}, registrations: {}, recoveredTicks: 0, skippedTicks: 0, patchFailures: [] };
  const trackedEvents = new Set(['blur', 'focus', 'visibilitychange', 'webkitvisibilitychange',
    'pagehide', 'pageshow', 'freeze', 'resume', 'beforeunload', 'focusin', 'focusout']);
  const logBudget = new Map();
  function log(kind, detail) {
    if (!settings.enabled || !settings.diagnostics) return;
    const count = (logBudget.get(kind) || 0) + 1;
    logBudget.set(kind, count);
    if (count <= 30 || count % 100 === 0) native.log(`[StayActive] ${kind}`, detail);
  }
  function label(target) {
    return target === window ? 'window' : target === document ? 'document' : 'element/other';
  }
  function patch(id, object, property, descriptor) {
    if (patches.has(id)) return;
    const before = Object.getOwnPropertyDescriptor(object, property);
    try {
      Object.defineProperty(object, property, { configurable: true, enumerable: before?.enumerable ?? false, ...descriptor });
      patches.set(id, { object, property, before, installed: Object.getOwnPropertyDescriptor(object, property) });
    } catch (error) {
      if (!stats.patchFailures.includes(id)) stats.patchFailures.push(id);
      log('patch unavailable', { property, reason: error.message });
    }
  }
  function restore(id) {
    const entry = patches.get(id);
    if (!entry) return;
    const current = Object.getOwnPropertyDescriptor(entry.object, entry.property);
    // Don't overwrite a subsequent patch made by the site or another extension.
    if (current?.get === entry.installed.get && current?.value === entry.installed.value) {
      try {
        if (entry.before) Object.defineProperty(entry.object, entry.property, entry.before);
        else delete entry.object[entry.property];
      } catch { /* the page may have made its descriptor non-configurable */ }
    }
    patches.delete(id);
  }
  function spoofProperty(property, value, enabled) {
    const id = `document.${property}`;
    if (!enabled) { restore(`${id}.own`); return restore(id); }
    const original = Object.getOwnPropertyDescriptor(Document.prototype, property);
    if (!original?.get) return;
    const getter = original.get;
    const replacement = { get() {
      const actual = Reflect.apply(getter, this, []); // preserve native receiver checks
      return protectedDocument(this) ? value : actual;
    } };
    patch(id, Document.prototype, property, replacement);
    patch(`${id}.own`, document, property, replacement);
  }

  function protectedDocument(candidate) {
    if (candidate === document) return true;
    // A patched getter borrowed from another protected same-host realm must
    // not reveal the native state of this document.
    try { return candidate.defaultView?.location.hostname === location.hostname; }
    catch { return false; }
  }
  function shouldSuppress(event) {
    if (!settings.enabled || !event.isTrusted) return false;
    const root = event.target === document || event.target === window;
    if (settings.hideVisibility && root &&
      ['visibilitychange', 'webkitvisibilitychange'].includes(event.type)) return true;
    if (!settings.preventBlur || !focusEvents.has(event.type)) return false;
    if (root) return true;
    const losing = event.type === 'blur' || event.type === 'focusout';
    const browserLostFocus = !Reflect.apply(native.hasFocus, document, []);
    // Tab deactivation can also emit blur/focusout on the still-active element.
    // Actual element-to-element changes have a new activeElement and must pass.
    if (losing && browserLostFocus && event.relatedTarget == null && event.target === document.activeElement) {
      returningElement = event.target;
      return true;
    }
    if (!losing && returningElement === event.target && event.relatedTarget == null &&
      event.target === document.activeElement) {
      if (event.type === 'focusin') returningElement = null;
      return true;
    }
    if (!losing || event.target !== document.activeElement) returningElement = null;
    return false;
  }

  // Early capture guards also cover property handlers. Root listeners get an
  // additional per-callback guard below; normal element focus remains usable.
  function observe(event) {
    if (!settings.enabled) return;
    stats.observed[event.type] = (stats.observed[event.type] || 0) + 1;
    const suppressed = shouldSuppress(event);
    log(suppressed ? 'suppressed event' : 'observed event', {
      type: event.type, target: label(event.target), trusted: event.isTrusted,
      nativeHidden: native.hidden ? Reflect.apply(native.hidden, document, []) : undefined,
      persisted: 'persisted' in event ? event.persisted : undefined
    });
    if (suppressed) {
      stats.suppressed[event.type] = (stats.suppressed[event.type] || 0) + 1;
      Reflect.apply(native.stop, event, []);
    }
  }
  for (const type of trackedEvents) Reflect.apply(native.add, window, [type, observe, true]);

  const listenerRecords = new WeakMap();
  function listenerList(target) {
    let records = listenerRecords.get(target);
    if (!records) { records = []; listenerRecords.set(target, records); }
    return records;
  }
  function rootSignal(target, type) {
    return (target === window || target === document) &&
      ['blur', 'focus', 'focusin', 'focusout', 'visibilitychange', 'webkitvisibilitychange'].includes(type);
  }
  function listenerOptions(options) {
    if (!options || typeof options !== 'object') return { capture: !!options };
    // Read the standard option getters once, in dictionary order.
    const capture = !!options.capture;
    const once = !!options.once;
    const passive = options.passive;
    const signal = options.signal;
    const normalized = { capture, once };
    if (passive !== undefined) normalized.passive = !!passive;
    if (signal !== undefined) normalized.signal = signal;
    return normalized;
  }
  function listenerProtection() {
    // Wrappers remain in a document until reload; settings are checked when an
    // event fires, so disabling protection restores behavior without reordering.
    patch('event.add', EventTarget.prototype, 'addEventListener', {
      writable: true,
      value: function addEventListener(type, callback, options) {
        // Inspect only primitive strings, never invoke a site's option getters twice.
        if (typeof type === 'string' && trackedEvents.has(type) && callback != null) {
          stats.registrations[type] = (stats.registrations[type] || 0) + 1;
          log('listener registered', { type, target: label(this) });
        }
        if (typeof type !== 'string' || !rootSignal(this, type) ||
          (typeof callback !== 'function' && (typeof callback !== 'object' || callback === null))) {
          return Reflect.apply(native.add, this, arguments);
        }
        const normalized = listenerOptions(options);
        const capture = normalized.capture;
        const records = listenerList(this);
        // Native addEventListener deduplicates by type, callback, capture only.
        const existing = records.find(record => record.type === type && record.callback === callback && record.capture === capture);
        if (existing) return Reflect.apply(native.add, this, [type, existing.wrapper, normalized]);
        const target = this;
        const record = { type, callback, capture, wrapper: null, cleanup: null };
        function forget() {
          const index = records.indexOf(record);
          if (index >= 0) records.splice(index, 1);
          if (record.cleanup) { record.cleanup(); record.cleanup = null; }
        }
        record.wrapper = function guardedListener(event) {
          // Last-line protection even if an earlier callback interferes with
          // capture propagation. A suppressed event must not consume `once`.
          if (shouldSuppress(event)) return;
          if (normalized.once) {
            Reflect.apply(native.remove, target, [type, record.wrapper, capture]);
            forget();
          }
          if (typeof callback === 'function') return Reflect.apply(callback, this, [event]);
          return callback.handleEvent(event);
        };
        const registration = { ...normalized, once: false };
        // Let Chrome validate the signal before retaining any bookkeeping.
        Reflect.apply(native.add, target, [type, record.wrapper, registration]);
        if (normalized.signal?.aborted) return;
        records.push(record);
        if (normalized.signal) {
          const onAbort = () => forget();
          Reflect.apply(native.add, normalized.signal, ['abort', onAbort, { once: true }]);
          record.cleanup = () => Reflect.apply(native.remove, normalized.signal, ['abort', onAbort]);
        }
      }
    });
    patch('event.remove', EventTarget.prototype, 'removeEventListener', {
      writable: true,
      value: function removeEventListener(type, callback, options) {
        if (typeof type !== 'string' || !rootSignal(this, type)) return Reflect.apply(native.remove, this, arguments);
        const capture = options && typeof options === 'object' ? !!options.capture : !!options;
        const records = listenerRecords.get(this);
        const record = records?.find(item => item.type === type && item.callback === callback && item.capture === capture);
        if (record) {
          Reflect.apply(native.remove, this, [type, record.wrapper, capture]);
          records.splice(records.indexOf(record), 1);
          if (record.cleanup) record.cleanup();
        }
        // Also remove a matching listener registered before late installation.
        return Reflect.apply(native.remove, this, [type, callback, capture]);
      }
    });
  }

  const intervals = new Map();
  const MAX_RECOVERY = 10;
  function timers(enabled) {
    if (!enabled) {
      restore('timer.interval');
      // Existing interval IDs still belong to Chrome. Keep clear wrappers only
      // until the managed intervals have been cleared by the page.
      if (!intervals.size) { restore('timer.clearInterval'); restore('timer.clearTimeout'); }
      return;
    }
    patch('timer.interval', window, 'setInterval', {
      writable: true,
      value: function setInterval(handler, delay, ...args) {
        if (typeof handler !== 'function') return Reflect.apply(native.interval, window, [handler, delay, ...args]);
        const period = Number(delay);
        // Leave fast UI/animation loops and invalid delays to Chrome unchanged.
        if (!Number.isFinite(period) || period < 250 || period > 2147483647) {
          return Reflect.apply(native.interval, window, [handler, period, ...args]);
        }
        const ms = Math.trunc(period);
        const entry = { next: native.now() + ms, id: 0 };
        entry.id = Reflect.apply(native.interval, window, [function tick() {
          const now = native.now();
          if (!settings.enabled || !settings.keepTimers) {
            entry.next = now + ms;
            return Reflect.apply(handler, window, args);
          }
          // There is no bypass of Chrome's scheduler. Compensate only on wake.
          const due = Math.max(1, Math.floor((now - entry.next) / ms) + 1);
          entry.next = Math.max(entry.next + due * ms, now + 1);
          const calls = Math.min(due, MAX_RECOVERY);
          stats.skippedTicks += due - calls;
          if (due > 1) log('interval recovery', { period: ms, due, calls, skipped: due - calls });
          for (let i = 0; i < calls; i++) {
            if (!intervals.has(entry.id)) break; // callback may clear its own ID
            if (i > 0 && (!settings.enabled || !settings.keepTimers)) break;
            if (i > 0) stats.recoveredTicks++;
            // A throwing callback must still report an uncaught page error.
            Reflect.apply(handler, window, args);
          }
        }, ms]);
        intervals.set(entry.id, entry);
        return entry.id;
      }
    });
    for (const property of ['clearInterval', 'clearTimeout']) {
      patch(`timer.${property}`, window, property, { writable: true, value: function clearTimer(id) {
        // Browser timer IDs are numeric. Also accept the ordinary string form.
        if (typeof id === 'number' || typeof id === 'string') intervals.delete(Number(id));
        const result = Reflect.apply(native[property], window, arguments);
        if (!intervals.size && (!settings.enabled || !settings.keepTimers)) timers(false);
        return result;
      } });
    }
  }

  function configure(value) {
    settings = Object.fromEntries(['enabled', 'hideVisibility', 'preventBlur', 'keepTimers', 'diagnostics']
      .map(key => [key, value[key] === true]));
    const visible = settings.enabled && settings.hideVisibility;
    for (const [property, fake] of [['hidden', false], ['visibilityState', 'visible'],
      ['webkitHidden', false], ['webkitVisibilityState', 'visible']]) spoofProperty(property, fake, visible);
    if (settings.enabled && settings.preventBlur) {
      const replacement = { writable: true, value: function hasFocus() {
        const actual = Reflect.apply(native.hasFocus, this, arguments);
        return protectedDocument(this) ? true : actual;
      } };
      patch('document.hasFocus', Document.prototype, 'hasFocus', replacement);
      patch('document.hasFocus.own', document, 'hasFocus', replacement);
    } else {
      restore('document.hasFocus.own'); restore('document.hasFocus');
      returningElement = null;
    }
    listenerProtection();
    timers(settings.enabled && settings.keepTimers);
    log('configuration', { ...settings, propertyHandlers: 'on* assignments work; not instrumented' });
    return snapshot();
  }
  function snapshot() {
    return { installation: { ...installation }, settings: { ...settings },
      effective: { hidden: document.hidden, visibilityState: document.visibilityState, hasFocus: document.hasFocus() },
      stats: JSON.parse(JSON.stringify(stats)), managedIntervals: intervals.size };
  }
  // Readable in the page console; no privileged APIs, storage bridge or secrets.
  Object.defineProperty(window, KEY, { configurable: false, value: Object.freeze({ configure, snapshot }) });
  configure(boot);
})();
