// Canvas compositing: draws the screen capture full-frame with the camera as
// a clipped picture-in-picture bubble. The canvas doubles as the live preview
// and as the recorded surface (via captureStream), so what you see is exactly
// what gets recorded.

let canvas = null;
let ctx = null;
let mode = 'screen';
let worker = null;
let running = false;

const screenVideo = makeVideo();
const cameraVideo = makeVideo();

// Bubble state, normalized 0..1 relative to canvas size. Width is a fraction
// of canvas width; height follows from shape (1:1 circle, 16:9 rectangle).
const bubble = { x: 0.88, y: 0.80, w: 0.09, shape: 'circle', visible: true };

// Laser-pointer overlay. Position is normalized 0..1; drawn on top of
// everything so it's burned into the recording. `tick` drives a subtle pulse.
const laser = { x: 0.5, y: 0.5, visible: false };
let tick = 0;

function makeVideo() {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  return v;
}

async function attach(video, stream) {
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) {
    await new Promise((res) =>
      video.addEventListener('loadedmetadata', res, { once: true })
    );
  }
}

export async function init(opts) {
  mode = opts.mode;
  canvas = opts.canvas;
  ctx = canvas.getContext('2d');

  if (opts.screenStream) await attach(screenVideo, opts.screenStream);
  if (opts.cameraStream) await attach(cameraVideo, opts.cameraStream);

  const source = mode === 'camera' ? cameraVideo : screenVideo;
  const w = source.videoWidth || 1280;
  const h = source.videoHeight || 720;
  // Cap the longest edge (HiDPI screens report 2x capture sizes) and keep
  // dimensions even — encoders prefer it.
  const scale = Math.min(1, 1920 / Math.max(w, h));
  canvas.width = Math.round(w * scale) & ~1;
  canvas.height = Math.round(h * scale) & ~1;
  draw();
}

// Draw once before capturing so the stream never starts on a black frame.
export function getStream(fps = 30) {
  draw();
  return canvas.captureStream(fps);
}

export function start() {
  if (running) return;
  running = true;
  worker = new Worker('js/tick-worker.js');
  worker.onmessage = () => {
    if (running) draw();
  };
  worker.postMessage({ cmd: 'start', interval: 33 });
}

export function stop() {
  running = false;
  if (worker) {
    worker.postMessage({ cmd: 'stop' });
    worker.terminate();
    worker = null;
  }
  screenVideo.srcObject = null;
  cameraVideo.srcObject = null;
}

export function setBubble(partial) {
  Object.assign(bubble, partial);
}

export function getBubble() {
  return { ...bubble };
}

export function getCanvasAspect() {
  return canvas ? canvas.width / canvas.height : 16 / 9;
}

export function setLaser(partial) {
  Object.assign(laser, partial);
}

export function getLaser() {
  return { ...laser };
}

function bubblePixelRect() {
  const w = bubble.w * canvas.width;
  const h = bubble.shape === 'circle' ? w : (w * 9) / 16;
  return { x: bubble.x * canvas.width, y: bubble.y * canvas.height, w, h };
}

function draw() {
  tick++;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  if (mode === 'camera') {
    if (cameraVideo.readyState >= 2) drawCover(cameraVideo, 0, 0, W, H);
  } else {
    if (screenVideo.readyState >= 2) drawContain(screenVideo, 0, 0, W, H);
    if (mode === 'screen+camera' && bubble.visible && cameraVideo.readyState >= 2) {
      drawBubble();
    }
  }

  // Laser sits on top of everything, including the camera bubble.
  if (laser.visible) drawLaser();
}

// Letterbox: the screen track's resolution can change mid-capture (e.g. the
// shared window is resized), so never stretch it to the canvas.
function drawContain(video, dx, dy, dw, dh) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const s = Math.min(dw / vw, dh / vh);
  const w = vw * s;
  const h = vh * s;
  ctx.drawImage(video, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
}

// Scale to fill and center-crop the overflow via drawImage source rect.
function drawCover(video, dx, dy, dw, dh) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const s = Math.max(dw / vw, dh / vh);
  const sw = dw / s;
  const sh = dh / s;
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, dx, dy, dw, dh);
}

function bubblePath(r) {
  ctx.beginPath();
  if (bubble.shape === 'circle') {
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2);
  } else if (ctx.roundRect) {
    ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(16, r.w * 0.08));
  } else {
    ctx.rect(r.x, r.y, r.w, r.h);
  }
}

function drawBubble() {
  const r = bubblePixelRect();
  ctx.save();
  bubblePath(r);
  ctx.clip();
  drawCover(cameraVideo, r.x, r.y, r.w, r.h);
  ctx.restore();
  bubblePath(r);
  ctx.lineWidth = Math.max(2, canvas.width * 0.002);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.stroke();
}

// Glowing red laser dot: a soft pulsing halo with a bright white-hot core.
function drawLaser() {
  const cx = laser.x * canvas.width;
  const cy = laser.y * canvas.height;
  const pulse = 0.85 + 0.15 * Math.sin(tick * 0.25);
  const core = Math.max(5, canvas.width * 0.0045);
  const glow = core * 5 * pulse;

  ctx.save();
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, glow);
  halo.addColorStop(0, 'rgba(255, 45, 45, 0.55)');
  halo.addColorStop(0.4, 'rgba(255, 20, 20, 0.28)');
  halo.addColorStop(1, 'rgba(255, 0, 0, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, glow, 0, Math.PI * 2);
  ctx.fill();

  const center = ctx.createRadialGradient(cx, cy, 0, cx, cy, core);
  center.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
  center.addColorStop(0.5, 'rgba(255, 90, 90, 0.97)');
  center.addColorStop(1, 'rgba(230, 0, 0, 0.95)');
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(cx, cy, core, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
