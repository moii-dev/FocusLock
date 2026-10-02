export const DEFAULTS = Object.freeze({
  enabled: false,
  hideVisibility: true,
  preventBlur: true,
  keepTimers: false,
  diagnostics: false
});

export function normalizeSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) =>
    [key, typeof value[key] === 'boolean' ? value[key] : fallback]));
}

export function siteFromUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    // IPv6 hosts are not supported by Chrome's host match-pattern grammar.
    if (url.hostname.includes(':')) return null;
    return url.hostname.toLowerCase();
  } catch { return null; }
}

export const storageKey = host => `site:${host}`;
export const originsFor = host => [`http://${host}/*`, `https://${host}/*`];
export const scriptId = host => `focuslock-${host}`;
export function configMask(settings) {
  return Number(settings.hideVisibility) | (Number(settings.preventBlur) << 1) |
    (Number(settings.keepTimers) << 2) | (Number(settings.diagnostics) << 3);
}

export function registrationFor(host, settings) {
  return {
    id: scriptId(host), matches: originsFor(host),
    js: [`scripts/config/${configMask(settings)}.js`, 'scripts/main.js'],
    world: 'MAIN', runAt: 'document_start', persistAcrossSessions: true,
    allFrames: true, matchOriginAsFallback: true
  };
}
