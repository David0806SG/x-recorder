// Media stream acquisition, device enumeration and error mapping.

const md = navigator.mediaDevices;

export function isSupported() {
  return !!(md && md.getDisplayMedia && md.getUserMedia && window.MediaRecorder);
}

export async function acquireScreen() {
  // audio: true surfaces Chrome's "Also share tab/system audio" checkbox.
  return md.getDisplayMedia({
    video: { frameRate: { ideal: 30 } },
    audio: true,
  });
}

export async function acquireCamera(deviceId) {
  return md.getUserMedia({
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
}

export async function acquireMic(deviceId) {
  return md.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
}

// Device labels are blank until permission has been granted once, so grab a
// throwaway stream, stop it, then enumerate.
export async function primePermissions() {
  try {
    const s = await md.getUserMedia({ audio: true, video: true });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    // One device may be missing/denied; try each alone so the other still
    // gets labelled.
    for (const constraints of [{ audio: true }, { video: true }]) {
      try {
        const s = await md.getUserMedia(constraints);
        s.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
    }
  }
}

export async function listDevices() {
  const devices = await md.enumerateDevices();
  return {
    cameras: devices.filter((d) => d.kind === 'videoinput'),
    mics: devices.filter((d) => d.kind === 'audioinput'),
  };
}

export function onDeviceChange(fn) {
  md.addEventListener('devicechange', fn);
}

// NotAllowedError from getDisplayMedia usually means the user dismissed the
// share picker — treat as a silent cancel, not an error.
export function isPickerCancel(err) {
  return err?.name === 'NotAllowedError';
}

export function mapError(err, device) {
  switch (err?.name) {
    case 'NotAllowedError':
      return `Permission for the ${device} was denied. Allow it in the browser's site settings and try again.`;
    case 'NotFoundError':
      return `No ${device} was found on this device.`;
    case 'NotReadableError':
      return `The ${device} is already in use by another application.`;
    case 'OverconstrainedError':
      return `The selected ${device} is unavailable — it may have been unplugged.`;
    default:
      return `Could not access the ${device}: ${err?.message || err}`;
  }
}
