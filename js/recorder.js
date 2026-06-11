// MediaRecorder lifecycle: codec negotiation, chunk collection, blob assembly.

let recorder = null;
let chunks = [];
let mimeType = '';

const CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.64001f,mp4a.40.2', // Safari, Chrome 126+
  'video/mp4',
];

export function pickMimeType() {
  return CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export function start(stream, onError) {
  mimeType = pickMimeType();
  console.info('[recorder] mimeType:', mimeType || '(browser default)');
  chunks = [];
  recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 8_000_000,
  });
  if (!mimeType) mimeType = recorder.mimeType;
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onerror = (e) => onError?.(e.error || new Error('Recording failed'));
  // 1s timeslice: data flushes incrementally, a crash loses at most ~1s.
  recorder.start(1000);
}

export function pause() {
  if (recorder?.state === 'recording') recorder.pause();
}

export function resume() {
  if (recorder?.state === 'paused') recorder.resume();
}

export function stop() {
  return new Promise((resolve) => {
    if (!recorder || recorder.state === 'inactive') {
      resolve(assemble());
      return;
    }
    recorder.onstop = () => resolve(assemble());
    recorder.stop();
  });
}

function assemble() {
  const blob = new Blob(chunks, { type: (mimeType || 'video/webm').split(';')[0] });
  chunks = [];
  recorder = null;
  return blob;
}

export function getMimeType() {
  return mimeType || 'video/webm';
}

export function getExtension() {
  return getMimeType().includes('mp4') ? 'mp4' : 'webm';
}

export function getState() {
  return recorder?.state || 'inactive';
}
