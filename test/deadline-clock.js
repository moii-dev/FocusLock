// The reliable approach for a site you can change: time is derived from a
// deadline, never from the number of callbacks the browser managed to deliver.
export function createDeadlineClock({ durationMs, render, onComplete = () => {} }) {
  const deadline = Date.now() + durationMs;
  let timer;
  let stopped = false;
  function update() {
    if (stopped) return;
    const remaining = Math.max(0, deadline - Date.now());
    render(remaining);
    if (remaining === 0) {
      stopped = true;
      clearInterval(timer);
      onComplete();
    }
  }
  // Scheduling is for repainting only; throttling cannot corrupt the deadline.
  timer = setInterval(update, 250);
  update();
  return { deadline, update, stop() { stopped = true; clearInterval(timer); } };
}
