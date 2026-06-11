// Screen transitions, countdown, timer, error banner, preview/download.

const $ = (sel) => document.querySelector(sel);

export function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`#screen-${name}`).classList.add('active');
}

export function showError(msg) {
  const b = $('#errorBanner');
  b.textContent = msg;
  b.classList.remove('hidden');
}

export function clearError() {
  $('#errorBanner').classList.add('hidden');
}

/* ---------- Countdown ---------- */

let countdown = null;

export function runCountdown(n = 3) {
  const overlay = $('#countdownOverlay');
  const num = $('#countdownNum');
  overlay.classList.remove('hidden');
  return new Promise((resolve) => {
    let i = n;
    let timeout = null;
    const finish = (ok) => {
      clearTimeout(timeout);
      overlay.classList.add('hidden');
      countdown = null;
      resolve(ok);
    };
    countdown = { cancel: () => finish(false) };
    const tick = () => {
      if (i === 0) return finish(true);
      num.textContent = i;
      num.classList.remove('pop');
      void num.offsetWidth; // restart the CSS animation
      num.classList.add('pop');
      i--;
      timeout = setTimeout(tick, 1000);
    };
    tick();
  });
}

export function cancelCountdown() {
  countdown?.cancel();
}

/* ---------- Timer ---------- */
// Render from performance.now() deltas — counting ticks drifts.

let startTs = 0;
let pausedAccum = 0;
let pausedAt = 0;
let interval = null;

export function startTimer() {
  startTs = performance.now();
  pausedAccum = 0;
  pausedAt = 0;
  renderTimer();
  interval = setInterval(renderTimer, 250);
}

export function pauseTimer() {
  pausedAt = performance.now();
  renderTimer();
}

export function resumeTimer() {
  pausedAccum += performance.now() - pausedAt;
  pausedAt = 0;
}

export function stopTimer() {
  clearInterval(interval);
  interval = null;
}

function renderTimer() {
  const now = pausedAt || performance.now();
  const s = Math.max(0, Math.floor((now - startTs - pausedAccum) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  $('#timer').textContent = `${mm}:${ss}`;
}

/* ---------- Preview ---------- */

export function showPreview(blob, mimeType, objectUrl, extension) {
  const video = $('#previewVideo');
  video.src = objectUrl;
  video.addEventListener(
    'loadedmetadata',
    () => {
      // Chrome's MediaRecorder writes no duration metadata into WebM, so the
      // player reports Infinity and the seekbar is broken. Seeking far past
      // the end forces Chrome to compute the real duration.
      if (video.duration === Infinity) {
        video.currentTime = 1e101;
        video.addEventListener(
          'timeupdate',
          () => {
            video.currentTime = 0;
          },
          { once: true }
        );
      }
    },
    { once: true }
  );

  $('#previewMeta').textContent =
    `${(blob.size / 1048576).toFixed(1)} MB · ${mimeType}`;

  const link = $('#downloadLink');
  link.href = objectUrl;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  link.download =
    `recording-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${extension}`;
}

export function clearPreview() {
  const video = $('#previewVideo');
  video.removeAttribute('src');
  video.load();
}
