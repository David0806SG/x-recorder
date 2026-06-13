// App orchestration: SETUP → COUNTDOWN → RECORDING ⇄ PAUSED → PREVIEW.

import * as capture from './capture.js';
import * as compositor from './compositor.js';
import * as mixer from './audio-mixer.js';
import * as recorder from './recorder.js';
import * as exporter from './exporter.js';
import * as bubble from './bubble.js';
import * as ui from './ui.js';

const $ = (sel) => document.querySelector(sel);

const app = {
  state: 'SETUP',
  screenStream: null,
  cameraStream: null,
  micStream: null,
  previewStream: null, // setup-screen camera thumbnail
  compositeStream: null,
  recordingBlob: null,
  exportJob: null,
  objectUrl: null,
  micMuted: false,
  sysMuted: false,
  hasMic: false,
  hasSystem: false,
};

/* ---------- Setup screen ---------- */

async function refreshDevices() {
  try {
    const { cameras, mics } = await capture.listDevices();
    fillSelect($('#cameraSelect'), cameras, 'Camera');
    fillSelect($('#micSelect'), mics, 'Microphone');
  } catch (err) {
    console.warn('Device enumeration failed:', err);
  }
}

function fillSelect(select, devices, fallbackLabel) {
  const prev = select.value;
  select.innerHTML = '';
  devices.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `${fallbackLabel} ${i + 1}`;
    select.appendChild(opt);
  });
  if ([...select.options].some((o) => o.value === prev)) select.value = prev;
}

async function updateCameraPreview() {
  stopStream(app.previewStream);
  app.previewStream = null;
  const bubbleEl = $('#setupBubble');
  $('#thumbVideo').srcObject = null;
  $('#cameraSelect').disabled = !$('#cameraToggle').checked;
  if (app.state !== 'SETUP' || !$('#cameraToggle').checked) {
    bubbleEl.classList.add('hidden');
    return;
  }
  try {
    app.previewStream = await capture.acquireCamera($('#cameraSelect').value || undefined);
    $('#thumbVideo').srcObject = app.previewStream;
    bubbleEl.classList.remove('hidden');
    bubble.syncSetup();
  } catch (err) {
    bubbleEl.classList.add('hidden');
    ui.showError(capture.mapError(err, 'camera'));
  }
}

/* ---------- Recording flow ---------- */

async function startFlow() {
  // Re-entrancy guard: while we await permission prompts another Start click
  // would otherwise interleave a second flow (two MediaRecorders, one lost).
  if (app.state !== 'SETUP') return;
  app.state = 'ACQUIRING';
  ui.clearError();
  const startBtn = $('#startBtn');
  startBtn.disabled = true;
  // Screen-only when the camera is toggled off (may also degrade to it if
  // the camera fails to start).
  let mode = $('#cameraToggle').checked ? 'screen+camera' : 'screen';
  try {
    const wantMic = $('#micToggle').checked;

    // Acquire all streams first — permission prompts happen before the
    // countdown, so 3-2-1 leads straight into actual recording.
    try {
      app.screenStream = await capture.acquireScreen();
    } catch (err) {
      // Dismissing the share picker is a normal cancel, not an error.
      if (!capture.isPickerCancel(err)) ui.showError(capture.mapError(err, 'screen'));
      return;
    }

    if (mode === 'screen+camera') {
      if (app.previewStream) {
        // Reuse the setup-preview stream — same device, same constraints.
        app.cameraStream = app.previewStream;
        app.previewStream = null;
        $('#thumbVideo').srcObject = null;
        $('#setupBubble').classList.add('hidden');
      } else {
        try {
          app.cameraStream = await capture.acquireCamera($('#cameraSelect').value || undefined);
        } catch (err) {
          const msg = capture.mapError(err, 'camera');
          if (confirm(`${msg}\n\nContinue recording the screen only?`)) {
            mode = 'screen';
          } else {
            ui.showError(msg);
            releaseAll();
            return;
          }
        }
      }
    }

    if (wantMic) {
      try {
        app.micStream = await capture.acquireMic($('#micSelect').value || undefined);
      } catch (err) {
        console.warn('Continuing without microphone:', err);
      }
    }

    await compositor.init({
      mode,
      canvas: $('#stage'),
      screenStream: app.screenStream,
      cameraStream: app.cameraStream,
    });

    const canvasStream = compositor.getStream(30);
    const { mixedTrack, hasMic, hasSystem } = await mixer.init({
      micStream: app.micStream,
      screenStream: app.screenStream,
    });
    app.hasMic = hasMic;
    app.hasSystem = hasSystem;

    const tracks = [...canvasStream.getVideoTracks()];
    if (mixedTrack) tracks.push(mixedTrack);
    app.compositeStream = new MediaStream(tracks);

    app.screenStream
      ?.getVideoTracks()[0]
      .addEventListener('ended', onScreenEnded);
    app.cameraStream
      ?.getVideoTracks()[0]
      .addEventListener('ended', onCameraEnded);

    setupRecordControls(mode);
    ui.showScreen('record');
    compositor.start();
    bubble.setEnabled(mode === 'screen+camera');

    app.state = 'COUNTDOWN';
    const ok = await ui.runCountdown(3);
    if (!ok) {
      cleanupToSetup();
      return;
    }

    recorder.start(app.compositeStream, (err) => {
      console.error('MediaRecorder error:', err);
      stopFlow();
    });
    app.state = 'RECORDING';
    ui.startTimer();
    $('#controlsBar').classList.remove('hidden');
  } catch (err) {
    console.error('Failed to start recording:', err);
    ui.showError(`Could not start the recording: ${err?.message || err}`);
    cleanupToSetup();
  } finally {
    // Early returns (picker cancel, device failure) land back on SETUP;
    // success has moved on to RECORDING by now.
    if (app.state === 'ACQUIRING') app.state = 'SETUP';
    startBtn.disabled = false;
  }
}

async function stopFlow() {
  if (app.state !== 'RECORDING' && app.state !== 'PAUSED') return;
  app.state = 'STOPPING';
  ui.stopTimer();
  const blob = await recorder.stop();
  compositor.stop();
  bubble.setEnabled(false);
  releaseAll();
  $('#controlsBar').classList.add('hidden');
  app.recordingBlob = blob;
  app.objectUrl = URL.createObjectURL(blob);
  ui.showPreview(blob, recorder.getMimeType(), app.objectUrl, recorder.getExtension());
  ui.showScreen('preview');
  app.state = 'PREVIEW';
}

// Countdown was cancelled or stream acquisition partially failed.
function cleanupToSetup() {
  compositor.stop();
  bubble.setEnabled(false);
  releaseAll();
  $('#controlsBar').classList.add('hidden');
  app.state = 'SETUP';
  ui.showScreen('setup');
  updateCameraPreview();
}

// "Record again" from the preview screen.
function resetFlow() {
  if (app.exportJob) return; // an MP4 export still needs the blob
  if (app.objectUrl) {
    URL.revokeObjectURL(app.objectUrl);
    app.objectUrl = null;
  }
  app.recordingBlob = null;
  ui.clearPreview();
  app.state = 'SETUP';
  ui.showScreen('setup');
  updateCameraPreview();
}

function onScreenEnded() {
  // The browser's native "Stop sharing" button — finish gracefully, never
  // lose the recording.
  if (app.state === 'RECORDING' || app.state === 'PAUSED') stopFlow();
  else if (app.state === 'COUNTDOWN') ui.cancelCountdown();
}

function onCameraEnded() {
  // Camera unplugged mid-recording: hide the bubble, keep recording.
  if (app.state !== 'RECORDING' && app.state !== 'PAUSED') return;
  bubble.setVisible(false);
  $('#hideBubbleBtn').disabled = true;
  $('#shapeBtn').disabled = true;
}

function setupRecordControls(mode) {
  app.micMuted = false;
  app.sysMuted = false;

  const micBtn = $('#micMuteBtn');
  micBtn.disabled = !app.hasMic;
  micBtn.title = app.hasMic ? '' : 'Microphone is off for this recording';
  micBtn.textContent = '🎤 Mic on';
  micBtn.classList.remove('muted');

  const sysBtn = $('#sysMuteBtn');
  sysBtn.disabled = !app.hasSystem;
  sysBtn.title = app.hasSystem
    ? ''
    : 'No system audio — share a tab and tick “Also share tab audio”';
  sysBtn.textContent = '🔊 System on';
  sysBtn.classList.remove('muted');

  const showBubbleControls = mode === 'screen+camera';
  for (const id of ['#shapeBtn', '#hideBubbleBtn', '#bubbleDivider']) {
    $(id).classList.toggle('hidden', !showBubbleControls);
  }
  const b = compositor.getBubble();
  const shapeBtn = $('#shapeBtn');
  shapeBtn.disabled = false;
  shapeBtn.textContent = b.shape === 'circle' ? '▭ Rectangle' : '⬤ Circle';
  const hideBtn = $('#hideBubbleBtn');
  hideBtn.disabled = false;
  hideBtn.textContent = b.visible ? '🚫 Hide camera' : '👤 Show camera';

  const pauseBtn = $('#pauseBtn');
  pauseBtn.textContent = '⏸ Pause';
  $('#recIndicator').classList.remove('paused');
}

function togglePause() {
  if (app.state === 'RECORDING') {
    recorder.pause();
    ui.pauseTimer();
    app.state = 'PAUSED';
    $('#pauseBtn').textContent = '▶ Resume';
    $('#recIndicator').classList.add('paused');
  } else if (app.state === 'PAUSED') {
    recorder.resume();
    ui.resumeTimer();
    app.state = 'RECORDING';
    $('#pauseBtn').textContent = '⏸ Pause';
    $('#recIndicator').classList.remove('paused');
  }
}

/* ---------- MP4 export ---------- */

const EXPORT_BITRATES = { 1080: 8_000_000, 720: 5_000_000, 480: 2_500_000 };
// Lower frame rates carry proportionally less motion data, so scale the
// bitrate down too — that's where the actual size saving comes from.
const FPS_BITRATE_FACTOR = { 30: 1, 24: 0.85, 15: 0.6 };

async function startExport() {
  if (!app.recordingBlob || app.exportJob) return;
  const res = Number(document.querySelector('input[name="exportRes"]:checked').value);
  const fps = Number(document.querySelector('input[name="exportFps"]:checked').value);

  $('#previewVideo').pause();
  $('#exportBtn').disabled = true;
  $('#againBtn').disabled = true;
  $('#exportProgress').classList.remove('hidden');
  setExportProgress(0);

  app.exportJob = exporter.exportMp4(app.recordingBlob, {
    maxHeight: res,
    fps,
    videoBitsPerSecond: Math.round(EXPORT_BITRATES[res] * FPS_BITRATE_FACTOR[fps]),
    onProgress: setExportProgress,
  });

  try {
    const blob = await app.exportJob.promise;
    triggerDownload(blob, `${timestampName()}-${res}p-${fps}fps.mp4`);
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('MP4 export failed:', err);
      $('#exportStatus').textContent = `Export failed: ${err?.message || err}`;
    }
  } finally {
    app.exportJob = null;
    $('#exportBtn').disabled = false;
    $('#againBtn').disabled = false;
    $('#exportProgress').classList.add('hidden');
  }
}

function setExportProgress(fraction) {
  const pct = Math.round(fraction * 100);
  $('#exportBarFill').style.width = `${pct}%`;
  $('#exportStatus').textContent = `Converting… ${pct}%`;
}

function timestampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `recording-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* ---------- Helpers ---------- */

function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

// Single teardown path for stop, cancel, reset and error — leaked tracks
// keep the camera light on.
function releaseAll() {
  for (const key of ['screenStream', 'cameraStream', 'micStream', 'compositeStream']) {
    stopStream(app[key]);
    app[key] = null;
  }
  mixer.close();
}

/* ---------- Wiring ---------- */

$('#startBtn').addEventListener('click', startFlow);
$('#stopBtn').addEventListener('click', stopFlow);
$('#cancelBtn').addEventListener('click', () => ui.cancelCountdown());
$('#againBtn').addEventListener('click', resetFlow);
$('#exportBtn').addEventListener('click', startExport);
$('#exportCancelBtn').addEventListener('click', () => app.exportJob?.cancel());
$('#pauseBtn').addEventListener('click', togglePause);

$('#micMuteBtn').addEventListener('click', () => {
  app.micMuted = !app.micMuted;
  mixer.setMicMuted(app.micMuted);
  const btn = $('#micMuteBtn');
  btn.textContent = app.micMuted ? '🎤 Mic muted' : '🎤 Mic on';
  btn.classList.toggle('muted', app.micMuted);
});

$('#sysMuteBtn').addEventListener('click', () => {
  app.sysMuted = !app.sysMuted;
  mixer.setSystemMuted(app.sysMuted);
  const btn = $('#sysMuteBtn');
  btn.textContent = app.sysMuted ? '🔊 System muted' : '🔊 System on';
  btn.classList.toggle('muted', app.sysMuted);
});

$('#shapeBtn').addEventListener('click', () => {
  const shape = bubble.toggleShape();
  $('#shapeBtn').textContent = shape === 'circle' ? '▭ Rectangle' : '⬤ Circle';
});

$('#hideBubbleBtn').addEventListener('click', () => {
  const visible = !compositor.getBubble().visible;
  bubble.setVisible(visible);
  $('#hideBubbleBtn').textContent = visible ? '🚫 Hide camera' : '👤 Show camera';
});

$('#cameraSelect').addEventListener('change', updateCameraPreview);
$('#cameraToggle').addEventListener('change', updateCameraPreview);

window.addEventListener('beforeunload', () => {
  if (app.objectUrl) URL.revokeObjectURL(app.objectUrl);
});

/* ---------- Init ---------- */

(async function init() {
  if (!capture.isSupported()) {
    ui.showError(
      'This browser does not support the required recording APIs ' +
        '(getDisplayMedia / MediaRecorder). Use a recent Chrome or Edge over ' +
        'https or localhost.'
    );
    $('#startBtn').disabled = true;
    return;
  }
  bubble.init({
    canvas: $('#stage'),
    overlay: $('#bubbleOverlay'),
    handle: $('#bubbleHandle'),
  });
  bubble.initSetup({
    stage: $('#setupStage'),
    bubbleEl: $('#setupBubble'),
    handle: $('#setupHandle'),
  });
  if (!exporter.pickMp4MimeType()) {
    const btn = $('#exportBtn');
    btn.disabled = true;
    btn.title = 'This browser cannot encode MP4 — use the WebM download instead.';
  }
  await capture.primePermissions();
  await refreshDevices();
  capture.onDeviceChange(refreshDevices);
  updateCameraPreview();
})();
