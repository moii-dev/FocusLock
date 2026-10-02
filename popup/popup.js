import { DEFAULTS, siteFromUrl, originsFor } from '../shared/settings.js';

const fields = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, document.getElementById(key)]));
const notice = document.getElementById('notice');
const group = document.getElementById('settings');
const reload = document.getElementById('reload');
let host = null;
let tabId = null;
let settings = { ...DEFAULTS };
let busy = false;
let page = null;
let registered = false;

function currentProtection() {
  if (!page?.installed || page.installation?.version !== '1.1.0' || !page.settings?.enabled) return false;
  if (Object.entries(settings).some(([key, value]) => page.settings[key] !== value)) return false;
  if (settings.hideVisibility && (!page.settings.hideVisibility || page.effective?.hidden !== false || page.effective?.visibilityState !== 'visible')) return false;
  if (settings.preventBlur && (!page.settings.preventBlur || page.effective?.hasFocus !== true)) return false;
  return true;
}
function protectionNotice() {
  if (!settings.enabled) return 'Off. Preferences saved for next time.';
  if (!registered) return 'Site access or early registration is missing. Enable the switch again.';
  if (!currentProtection()) return 'Protection is not confirmed in this tab. Reload the page after updating the extension.';
  if (page.installation.source !== 'document_start') return 'Hooks installed late. Reload tab so protection precedes site scripts.';
  return 'Visibility and focus hooks confirmed in this tab at document_start.';
}

function show(message, error = false) {
  notice.textContent = message;
  notice.classList.toggle('error', error);
}
function render() {
  for (const [key, field] of Object.entries(fields)) field.checked = settings[key];
  fields.enabled.disabled = !host || busy;
  group.disabled = !host || busy;
  reload.disabled = !host || busy;
  document.getElementById('mode').textContent = !settings.enabled ? 'Off for this domain' :
    currentProtection() && registered ? 'Hooks installed in this tab' : 'Reload required · protection unconfirmed';
}
async function request(message) {
  const result = await chrome.runtime.sendMessage({ ...message, host, tabId });
  if (!result?.ok) throw new Error(result?.error || 'The extension did not respond. Please reopen the popup.');
  return result;
}

for (const [key, field] of Object.entries(fields)) {
  field.addEventListener('change', async () => {
    if (!host || busy) return;
    const next = { ...settings, [key]: field.checked };
    busy = true;
    // permissions.request MUST be called directly from a user gesture, before awaits.
    const permission = key === 'enabled' && next.enabled
      ? chrome.permissions.request({ origins: originsFor(host) }) : Promise.resolve(true);
    render();
    show('Saving…');
    try {
      if (!(await permission)) throw new Error('Site access was declined. StayActive remains off.');
      const result = await request({ type: 'SET_SITE', settings: next });
      settings = result.settings;
      page = result.pageStatus;
      registered = result.registered;
      document.getElementById('saved').textContent = 'Saved for this domain';
      show(result.liveFailures ? 'Saved. Reload this tab to apply all changes.' : protectionNotice(),
        settings.enabled && !currentProtection());
    } catch (error) { show(error.message, true); }
    finally { busy = false; render(); }
  });
}
reload.addEventListener('click', async () => {
  try {
    const current = await chrome.tabs.get(tabId);
    if (siteFromUrl(current.url) !== host) throw new Error('This tab has navigated. Reopen StayActive.');
    await chrome.tabs.reload(tabId);
    window.close();
  } catch (error) { show(error.message, true); }
});

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    host = siteFromUrl(tab?.url);
    if (['chromewebstore.google.com'].includes(host) ||
      (host === 'chrome.google.com' && new URL(tab.url).pathname.startsWith('/webstore'))) host = null;
    tabId = tab?.id;
    document.getElementById('domain').textContent = host || 'Unavailable on this page';
    if (!host) {
      show('Open an ordinary HTTP or HTTPS website to use StayActive.');
      return;
    }
    const result = await request({ type: 'GET_SITE' });
    settings = result.settings;
    page = result.pageStatus;
    registered = result.registered;
    show(protectionNotice(), settings.enabled && !currentProtection());
  } catch (error) { host = null; show(error.message, true); }
  finally { render(); }
}
init();
