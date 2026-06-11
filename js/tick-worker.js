// Worker-driven tick source for the compositor draw loop.
// requestAnimationFrame freezes in hidden tabs, which would freeze the
// recording the moment the user switches to the tab they're capturing —
// worker timers keep firing.
let id = null;

onmessage = (e) => {
  if (e.data.cmd === 'start') {
    clearInterval(id);
    id = setInterval(() => postMessage('tick'), e.data.interval);
  } else if (e.data.cmd === 'stop') {
    clearInterval(id);
    id = null;
  }
};
