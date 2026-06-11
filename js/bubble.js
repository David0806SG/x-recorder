// Camera-bubble interaction in two places, both writing to the same
// normalized bubble state in compositor.js, so the position chosen on the
// setup screen carries straight into the recording:
//  - the setup-screen mockup (#setupStage / #setupBubble): a 16:9 stand-in
//    for the screen with the live camera inside the bubble
//  - the recording stage (#bubbleOverlay): a transparent DOM overlay above
//    the compositing canvas; rendering happens only on the canvas
// Coordinates are normalized against the reference element's bounding rect,
// so CSS scaling is irrelevant.

import * as compositor from './compositor.js';

/* ---------- Recording-stage overlay ---------- */

let canvas = null;
let overlay = null;
let handle = null;
let enabled = false;
let drag = null; // { type: 'move' | 'resize', start: {x,y}, bubble: snapshot }

export function init(els) {
  ({ canvas, overlay, handle } = els);
  overlay.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointerdown', onDownResize);
  window.addEventListener('resize', () => {
    if (enabled) sync();
  });
}

export function setEnabled(on) {
  enabled = on;
  if (on) {
    clamp(compositor.getCanvasAspect());
    sync();
  }
  updateOverlayVisibility();
}

export function setVisible(visible) {
  compositor.setBubble({ visible });
  updateOverlayVisibility();
}

export function toggleShape() {
  const b = compositor.getBubble();
  const shape = b.shape === 'circle' ? 'rect' : 'circle';
  compositor.setBubble({ shape });
  clamp(compositor.getCanvasAspect());
  sync();
  return shape;
}

function updateOverlayVisibility() {
  const show = enabled && compositor.getBubble().visible;
  overlay.classList.toggle('hidden', !show);
}

function onDown(e) {
  if (!enabled || e.target === handle) return;
  e.preventDefault();
  capturePointer(overlay, e);
  drag = { type: 'move', start: normIn(canvas, e), bubble: compositor.getBubble() };
  overlay.addEventListener('pointermove', onMove);
  overlay.addEventListener('pointerup', onUp, { once: true });
}

function onDownResize(e) {
  if (!enabled) return;
  e.preventDefault();
  e.stopPropagation();
  capturePointer(handle, e);
  drag = { type: 'resize', start: normIn(canvas, e), bubble: compositor.getBubble() };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp, { once: true });
}

function onMove(e) {
  if (!drag) return;
  applyDrag(drag, normIn(canvas, e));
  clamp(compositor.getCanvasAspect());
  sync();
}

function onUp() {
  drag = null;
  overlay.removeEventListener('pointermove', onMove);
  handle.removeEventListener('pointermove', onMove);
}

// Mirror the bubble's canvas-space rect onto the DOM overlay (display px).
export function sync() {
  const b = compositor.getBubble();
  const r = canvas.getBoundingClientRect();
  const wrap = overlay.offsetParent?.getBoundingClientRect() || r;
  const k = b.shape === 'circle' ? 1 : 9 / 16;
  const wPx = b.w * r.width;
  overlay.style.left = `${r.left - wrap.left + b.x * r.width}px`;
  overlay.style.top = `${r.top - wrap.top + b.y * r.height}px`;
  overlay.style.width = `${wPx}px`;
  overlay.style.height = `${wPx * k}px`;
  overlay.style.borderRadius = b.shape === 'circle' ? '50%' : '12px';
}

/* ---------- Setup-screen preview ---------- */

let setupStage = null;
let setupBubble = null;
let setupHandle = null;
let setupDrag = null;

export function initSetup(els) {
  ({ stage: setupStage, bubbleEl: setupBubble, handle: setupHandle } = els);
  setupBubble.addEventListener('pointerdown', onSetupDown);
  setupHandle.addEventListener('pointerdown', onSetupDownResize);
  window.addEventListener('resize', () => {
    if (!setupBubble.classList.contains('hidden')) syncSetup();
  });
}

function stageAspect() {
  const r = setupStage.getBoundingClientRect();
  return r.height ? r.width / r.height : 16 / 9;
}

function onSetupDown(e) {
  if (e.target === setupHandle) return;
  e.preventDefault();
  capturePointer(setupBubble, e);
  setupDrag = { type: 'move', start: normIn(setupStage, e), bubble: compositor.getBubble() };
  setupBubble.addEventListener('pointermove', onSetupMove);
  setupBubble.addEventListener('pointerup', onSetupUp, { once: true });
}

function onSetupDownResize(e) {
  e.preventDefault();
  e.stopPropagation();
  capturePointer(setupHandle, e);
  setupDrag = { type: 'resize', start: normIn(setupStage, e), bubble: compositor.getBubble() };
  setupHandle.addEventListener('pointermove', onSetupMove);
  setupHandle.addEventListener('pointerup', onSetupUp, { once: true });
}

function onSetupMove(e) {
  if (!setupDrag) return;
  applyDrag(setupDrag, normIn(setupStage, e));
  clamp(stageAspect());
  syncSetup();
}

function onSetupUp() {
  setupDrag = null;
  setupBubble.removeEventListener('pointermove', onSetupMove);
  setupHandle.removeEventListener('pointermove', onSetupMove);
}

// Position the setup bubble inside the stage (its offset parent).
export function syncSetup() {
  const b = compositor.getBubble();
  const r = setupStage.getBoundingClientRect();
  const k = b.shape === 'circle' ? 1 : 9 / 16;
  const wPx = b.w * r.width;
  setupBubble.style.left = `${b.x * r.width}px`;
  setupBubble.style.top = `${b.y * r.height}px`;
  setupBubble.style.width = `${wPx}px`;
  setupBubble.style.height = `${wPx * k}px`;
  setupBubble.style.borderRadius = b.shape === 'circle' ? '50%' : '12px';
}

/* ---------- Shared helpers ---------- */

function normIn(el, e) {
  const r = el.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}

// Pointer capture can throw for already-released or synthetic pointers;
// dragging still works without it (we listen on the element itself).
function capturePointer(el, e) {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

function applyDrag(d, p) {
  const dx = p.x - d.start.x;
  const dy = p.y - d.start.y;
  if (d.type === 'move') {
    compositor.setBubble({ x: d.bubble.x + dx, y: d.bubble.y + dy });
  } else {
    compositor.setBubble({ w: d.bubble.w + dx });
  }
}

// Keep the bubble fully on-stage and within a sane size range.
function clamp(aspect) {
  const b = compositor.getBubble();
  const w = Math.min(0.5, Math.max(0.05, b.w));
  // Normalized height: pixel height / stage height.
  const k = b.shape === 'circle' ? 1 : 9 / 16;
  const hNorm = w * k * aspect;
  const x = Math.min(Math.max(0, 1 - w), Math.max(0, b.x));
  const y = Math.min(Math.max(0, 1 - hNorm), Math.max(0, b.y));
  compositor.setBubble({ x, y, w });
}
