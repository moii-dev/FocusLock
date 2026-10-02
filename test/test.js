const state = window.focusLockTest;
const element = id => document.getElementById(id);
element('host').textContent = location.hostname;
element('early').textContent = JSON.stringify(state.early, null, 2);

for (const id of ['input-a', 'input-b']) {
  element(id).addEventListener('focus', () => state.elementFocus++);
  element(id).addEventListener('blur', () => state.elementBlur++);
}
element('synthetic').addEventListener('click', () => window.dispatchEvent(new FocusEvent('blur')));
element('reset').addEventListener('click', () => {
  for (const type of Object.keys(state.counts)) state.counts[type] = 0;
  state.events.length = 0;
  state.ticks = 0;
  state.startedAt = Date.now();
  state.elementBlur = state.elementFocus = 0;
  state.restartCountdown();
  clearInterval(state.interval);
  state.interval = setInterval(() => state.ticks++, 1000);
  render();
});
function render() {
  element('hidden').textContent = String(document.hidden);
  element('visibility').textContent = document.visibilityState;
  element('focus-state').textContent = String(document.hasFocus());
  for (const type of ['blur','focus','visibilitychange']) element(type).textContent = state.counts[type];
  const elapsed = (Date.now() - state.startedAt) / 1000;
  element('elapsed').textContent = `${elapsed.toFixed(1)} s`;
  element('ticks').textContent = state.ticks;
  element('drift').textContent = `${(elapsed - state.ticks).toFixed(1)} s`;
  element('countdown').textContent = `${Math.floor(state.countdown.seconds / 60)}:${String(state.countdown.seconds % 60).padStart(2, '0')}`;
  element('countdown-signals').textContent = `Остановок через blur: ${state.countdown.pauses}; запусков через load/focus: ${state.countdown.starts}`;
  element('focus-bubbling').textContent = `Document focusin: ${state.counts.focusin}; focusout: ${state.counts.focusout}`;
  element('element-counts').textContent = `Элементы: focus = ${state.elementFocus}, blur = ${state.elementBlur}`;
  element('lifecycle').textContent = ['pagehide','pageshow','freeze','resume'].map(type => `${type}: ${state.counts[type]}`).join('\n');
  element('events').textContent = state.events.join('\n') || 'Событий пока нет.';
  const controller = window[Symbol.for('focuslock.controller.v1')];
  const snapshot = controller?.snapshot();
  element('extension-status').textContent = !snapshot ? 'Перехваты расширения не установлены. Включите домен и перезагрузите страницу.' :
    `StayActive: ${snapshot.settings.enabled ? 'включён' : 'выключен'} · visibility: ${snapshot.settings.hideVisibility} · blur: ${snapshot.settings.preventBlur} · timers: ${snapshot.settings.keepTimers}`;
  element('diagnostic').textContent = snapshot ? JSON.stringify(snapshot, null, 2) : 'Расширение не установлено в контексте этой страницы.';
}
render();
setInterval(render, 250);
