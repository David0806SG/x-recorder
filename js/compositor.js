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

function bubblePixelRect() {
  const w = bubble.w * canvas.width;
  const h = bubble.shape === 'circle' ? w : (w * 9) / 16;
  return { x: bubble.x * canvas.width, y: bubble.y * canvas.height, w, h };
}

function draw() {
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  if (mode === 'camera') {
    if (cameraVideo.readyState >= 2) drawCover(cameraVideo, 0, 0, W, H);
    return;
  }

  if (screenVideo.readyState >= 2) drawContain(screenVideo, 0, 0, W, H);
  if (mode === 'screen+camera' && bubble.visible && cameraVideo.readyState >= 2) {
    drawBubble();
  }
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
