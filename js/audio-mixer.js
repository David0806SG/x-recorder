// Web Audio mixing: mic + system audio each through a GainNode into one
// MediaStreamAudioDestinationNode. Muting sets gain to 0 (the track stays
// live, so mute/unmute mid-recording is seamless). The graph is never
// connected to the speakers — that would echo system audio back out.

let audioCtx = null;
let dest = null;
let micGain = null;
let sysGain = null;
// Keep source-node references: GC of a MediaStreamAudioSourceNode can silence
// audio in some Chrome versions.
let micSrc = null;
let sysSrc = null;

export async function init({ micStream, screenStream }) {
  const micTrack = micStream?.getAudioTracks()[0] || null;
  const sysTrack = screenStream?.getAudioTracks()[0] || null;
  const result = { mixedTrack: null, hasMic: !!micTrack, hasSystem: !!sysTrack };
  if (!micTrack && !sysTrack) return result; // video-only recording

  audioCtx = new AudioContext();
  // Autoplay policy can start the context suspended; we're inside the Start
  // button's click handler, a valid user gesture.
  await audioCtx.resume();
  dest = audioCtx.createMediaStreamDestination();

  if (micTrack) {
    micSrc = audioCtx.createMediaStreamSource(new MediaStream([micTrack]));
    micGain = audioCtx.createGain();
    micSrc.connect(micGain).connect(dest);
  }
  if (sysTrack) {
    sysSrc = audioCtx.createMediaStreamSource(new MediaStream([sysTrack]));
    sysGain = audioCtx.createGain();
    sysSrc.connect(sysGain).connect(dest);
  }

  result.mixedTrack = dest.stream.getAudioTracks()[0];
  return result;
}

// Short ramp avoids click artifacts at toggle points.
function setGain(node, value) {
  if (node && audioCtx) node.gain.setTargetAtTime(value, audioCtx.currentTime, 0.015);
}

export function setMicMuted(muted) {
  setGain(micGain, muted ? 0 : 1);
}

export function setSystemMuted(muted) {
  setGain(sysGain, muted ? 0 : 1);
}

export function close() {
  if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
  audioCtx = dest = micGain = sysGain = micSrc = sysSrc = null;
}
