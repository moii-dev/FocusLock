import { normalizeSettings, siteFromUrl, storageKey, originsFor, scriptId, registrationFor } from './shared/settings.js';

// Serialize worker jobs, including permission-removal callbacks and startup repair.
let queue = Promise.resolve();
function serialize(job) {
  const result = queue.then(job);
  queue = result.catch(error => console.error('[FocusLock]', error));
  return result;
}

async function reconcile(host, settings) {
  const id = scriptId(host);
  const allowed = settings.enabled && await chrome.permissions.contains({ origins: originsFor(host) });
  const [existing] = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (!allowed) {
    if (existing) await chrome.scripting.unregisterContentScripts({ ids: [id] });
    return false;
  }
  const spec = registrationFor(host, settings);
  if (existing) await chrome.scripting.updateContentScripts([spec]);
  else await chrome.scripting.registerContentScripts([spec]);
  return true;
}

async function repair() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const sites = await chrome.storage.local.get(null);
  const keep = new Set();
  for (const [key, value] of Object.entries(sites)) {
    if (!key.startsWith('site:')) continue;
    const host = siteFromUrl(`https://${key.slice(5)}/`);
    if (!host || key !== storageKey(host)) continue;
    const settings = normalizeSettings(value);
    if (settings.enabled && !(await chrome.permissions.contains({ origins: originsFor(host) }))) {
      settings.enabled = false;
      await chrome.storage.local.set({ [key]: settings });
      await applyToOpenTabs(host, settings);
    }
    if (await reconcile(host, settings)) keep.add(scriptId(host));
  }
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  const stale = scripts.filter(script => script.id.startsWith('focuslock-') && !keep.has(script.id));
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale.map(script => script.id) });
}

// Only matching frames may be modified, even in mixed-origin tabs.
async function applyToOpenTabs(host, settings) {
  const tabs = await chrome.tabs.query({ url: originsFor(host) });
  const results = await Promise.allSettled(tabs.map(async tab => {
    const frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true }, world: 'ISOLATED',
      func: () => {
        if (location.hostname) return location.hostname;
        try { return new URL(location.origin).hostname; } catch { /* opaque origin */ }
        try { return parent.location.hostname; } catch { return null; }
      }
    });
    const frameIds = frames.filter(frame => frame.result === host).map(frame => frame.frameId);
    if (!frameIds.length) return;
    const target = { tabId: tab.id, frameIds };
    // Files bootstrap a missing controller; they are a no-op in installed frames.
    if (settings.enabled) {
      await chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true,
        func: value => { window[Symbol.for('focuslock.config.v1')] = { ...value, source: 'live' }; },
        args: [settings] });
      await chrome.scripting.executeScript({ target, files: ['scripts/main.js'], world: 'MAIN', injectImmediately: true });
    }
    await chrome.scripting.executeScript({
      target, world: 'MAIN', injectImmediately: true,
      func: (expectedHost, value) => {
        let actualHost = location.hostname;
        if (!actualHost && location.origin !== 'null') {
          try { actualHost = new URL(location.origin).hostname; } catch { /* opaque origin */ }
        }
        if (!actualHost) {
          try { actualHost = parent.location.hostname; } catch { /* cross-origin parent */ }
        }
        if (actualHost !== expectedHost) return;
        const controller = window[Symbol.for('focuslock.controller.v1')];
        if (controller) return controller.configure(value);
      }, args: [host, settings]
    });
  }));
  // Navigating/closing a tab is expected. Surface partial live-application failures.
  return results.filter(result => result.status === 'rejected').length;
}

async function pageStatus(host, tabId) {
  if (!Number.isInteger(tabId)) return { installed: false, error: 'No tab selected.' };
  try {
    const tab = await chrome.tabs.get(tabId);
    if (siteFromUrl(tab.url) !== host) return { installed: false, error: 'The tab has navigated. Reopen StayActive.' };
    const [frame] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN',
      func: () => {
        const controller = window[Symbol.for('focuslock.controller.v1')];
        if (!controller) return { installed: false };
        return { installed: true, ...controller.snapshot() };
      }
    });
    return frame?.result || { installed: false };
  } catch (error) { return { installed: false, error: error.message }; }
}

async function handle(message) {
  const host = siteFromUrl(`https://${message.host}/`);
  if (!host || host !== message.host) throw new Error('Unsupported domain.');
  const key = storageKey(host);
  if (message.type === 'GET_SITE') {
    const stored = await chrome.storage.local.get(key);
    const settings = normalizeSettings(stored[key]);
    const registered = await reconcile(host, settings);
    return { settings, registered, pageStatus: await pageStatus(host, message.tabId) };
  }
  if (message.type !== 'SET_SITE') throw new Error('Unknown request.');
  const settings = normalizeSettings(message.settings);
  if (settings.enabled && !(await chrome.permissions.contains({ origins: originsFor(host) }))) {
    throw new Error('Site access was not granted. Enable the switch again to grant access.');
  }
  const previous = normalizeSettings((await chrome.storage.local.get(key))[key]);
  await chrome.storage.local.set({ [key]: settings });
  try { await reconcile(host, settings); }
  catch (error) {
    await chrome.storage.local.set({ [key]: previous });
    await reconcile(host, previous);
    throw error;
  }
  const liveFailures = await applyToOpenTabs(host, settings);
  // Retain only this domain's optional grant so disabling can restore open tabs.
  // Access can be revoked using Chrome's Details > Site access controls.
  return { settings, registered: settings.enabled, liveFailures, pageStatus: await pageStatus(host, message.tabId) };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.tab || !['GET_SITE', 'SET_SITE'].includes(message?.type)) return;
  serialize(() => handle(message)).then(result => reply({ ok: true, ...result }),
    error => reply({ ok: false, error: error.message }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => serialize(repair));
chrome.runtime.onStartup.addListener(() => serialize(repair));
chrome.permissions.onRemoved.addListener(() => serialize(repair));
serialize(repair);
