// MP4 export: re-encodes a finished recording at a target resolution by
// playing it through a hidden <video>, drawing scaled frames onto a canvas,
// and capturing canvas + audio with a second MediaRecorder using an MP4
// (H.264/AAC) mimeType. MediaRecorder captures wall-clock, so converting
// takes about as long as the recording itself.

// avc1 required: QuickTime/AVFoundation cannot play avc3 (in-band parameter
// sets), so files would open with "media isn't compatible" on macOS.
const MP4_CANDIDATES = [
  'video/mp4;codecs=avc1.64001f,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.64001f',
  'video/mp4',
];

export function pickMp4MimeType() {
  return MP4_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

// Returns { promise, cancel }. promise resolves with the MP4 Blob; cancel()
// aborts and rejects it with an AbortError.
export function exportMp4(sourceBlob, { maxHeight, fps = 30, videoBitsPerSecond, onProgress }) {
  let abortReject = () => {};
  const aborted = new Promise((_, rej) => {
    abortReject = rej;
  });
  // Every long wait races against cancellation.
  const race = (p) => Promise.race([p, aborted]);

  const url = URL.createObjectURL(sourceBlob);
  const video = document.createElement('video');
  const audioCtx = new AudioContext();
  const worker = new Worker('js/tick-worker.js');
  let progressInterval = null;
  let recorder = null;

  const cleanup = () => {
    clearInterval(progressInterval);
    worker.postMessage({ cmd: 'stop' });
    worker.terminate();
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    if (audioCtx.state !== 'closed') audioCtx.close();
  };

  const promise = (async () => {
    const mimeType = pickMp4MimeType();
    if (!mimeType) {
      throw new Error('This browser cannot encode MP4 (MediaRecorder has no MP4 support).');
    }

    video.playsInline = true;
    video.src = url;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    await race(
      new Promise((res, rej) => {
        video.addEventListener('loadedmetadata', res, { once: true });
        video.addEventListener('error', () => rej(new Error('Could not read the recording.')), {
          once: true,
        });
      })
    );

    // Chrome's WebM recordings report Infinity until forced to compute the
    // real duration by seeking far past the end.
    if (video.duration === Infinity) {
      video.currentTime = 1e101;
      await race(new Promise((res) => video.addEventListener('seeked', res, { once: true })));
      video.currentTime = 0;
      await race(new Promise((res) => video.addEventListener('seeked', res, { once: true })));
    }

    // Scale down to the target height, never up. Even dimensions for the encoder.
    const scale = Math.min(1, maxHeight / video.videoHeight);
    canvas.width = Math.round(video.videoWidth * scale) & ~1;
    canvas.height = Math.round(video.videoHeight * scale) & ~1;

    // Route the element's audio into the capture graph; it is no longer
    // audible once a MediaElementSource exists, so the export plays silently.
    const audioSrc = audioCtx.createMediaElementSource(video);
    const audioDest = audioCtx.createMediaStreamDestination();
    audioSrc.connect(audioDest);
    await race(audioCtx.resume());

    const draw = () => ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    draw();
    const stream = canvas.captureStream(fps);
    const audioTrack = audioDest.stream.getAudioTracks()[0];
    if (audioTrack) stream.addTrack(audioTrack);

    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const recorderDone = new Promise((res, rej) => {
      recorder.onstop = res;
      recorder.onerror = (e) => rej(e.error || new Error('MP4 encoding failed.'));
    });

    // Worker-driven draw loop keeps frames flowing if the tab is hidden.
    worker.onmessage = draw;
    worker.postMessage({ cmd: 'start', interval: Math.round(1000 / fps) });

    try {
      await race(video.play());
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // Autoplay-with-sound blocked: retry muted so at least video exports.
      console.warn('Unmuted playback blocked, exporting without audio:', err);
      video.muted = true;
      await race(video.play());
    }
    // No timeslice: per-slice flushing makes Chrome's MP4/avc1 muxer complain
    // about codec-description changes between fragments.
    recorder.start();

    progressInterval = setInterval(() => {
      if (video.duration > 0) onProgress?.(Math.min(1, video.currentTime / video.duration));
    }, 250);

    await race(new Promise((res) => video.addEventListener('ended', res, { once: true })));
    recorder.stop();
    await race(recorderDone);
    onProgress?.(1);

    return new Blob(chunks, { type: mimeType.split(';')[0] });
  })();

  // Single cleanup point for success, failure and cancel.
  promise.finally(cleanup).catch(() => {});

  return {
    promise,
    cancel() {
      const err = new Error('Export cancelled');
      err.name = 'AbortError';
      abortReject(err);
    },
  };
}
