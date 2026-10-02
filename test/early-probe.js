// Synchronous head script: demonstrates whether MAIN protection preceded site JS.
(() => {
  const state = window.focusLockTest = {
    startedAt: Date.now(), ticks: 0, elementBlur: 0, elementFocus: 0,
    countdown: { seconds: 300, interval: null, pauses: 0, starts: 0 },
    counts: { blur: 0, focus: 0, focusin: 0, focusout: 0, visibilitychange: 0, pagehide: 0, pageshow: 0, freeze: 0, resume: 0 },
    early: { hidden: document.hidden, visibilityState: document.visibilityState, hasFocus: document.hasFocus() },
    events: []
  };
  for (const type of Object.keys(state.counts)) {
    const target = ['blur', 'focus', 'pagehide', 'pageshow'].includes(type) ? window : document;
    target.addEventListener(type, event => {
      if (['blur','focus'].includes(type) && event.target !== window && event.target !== document) return;
      state.counts[type]++;
      state.events.unshift(`${new Date().toLocaleTimeString()}  ${type}  trusted=${event.isTrusted}`);
      state.events.length = Math.min(state.events.length, 40);
    }, true);
  }
  state.interval = setInterval(() => state.ticks++, 1000);
  // Reproduction of the relevant lifecycle, using our own code and no requests:
  // a page starts a countdown on load/focus and cancels it on window blur.
  function startCountdown() {
    clearInterval(state.countdown.interval);
    state.countdown.starts++;
    state.countdown.interval = setInterval(() => {
      if (state.countdown.seconds > 0) state.countdown.seconds--;
      else clearInterval(state.countdown.interval);
    }, 1000);
  }
  window.addEventListener('load', startCountdown);
  window.addEventListener('focus', startCountdown);
  window.addEventListener('blur', () => {
    state.countdown.pauses++;
    clearInterval(state.countdown.interval);
  });
  state.restartCountdown = () => {
    state.countdown.seconds = 300;
    state.countdown.pauses = state.countdown.starts = 0;
    startCountdown();
  };
})();
