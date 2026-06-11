# X-Recorder

A browser-based screen recorder (Clipchamp-style). Vanilla HTML/CSS/JS, no
build step, no dependencies.

## Features

- **Screen & Camera recording**: the camera is composited as a
  picture-in-picture bubble, burned into the output. (Falls back to
  screen-only if the camera is unavailable.)
- **Camera bubble**: position and size it on the setup screen's mockup before
  recording, then drag to reposition, resize via the corner handle, toggle
  circle/rectangle, hide/show — all live during recording and reflected in
  the final video (canvas-composited, WYSIWYG).
- **Audio mixing**: microphone + system/tab audio mixed via Web Audio, with
  independent mute toggles mid-recording.
- **Controls**: 3-2-1 countdown, pause/resume, elapsed timer.
- **Output**: in-browser preview, then download as **MP4 (H.264/AAC)** with a
  resolution choice (High 1080p / Medium 720p / Low 480p) and a frame-rate
  choice (Smooth 30 / Standard 24 / Compact 15 fps) to trade quality for file
  size — converted entirely in the browser (takes about as long as the
  recording; the source is never upscaled). The original WebM is also
  available as an instant download.

## Run

```sh
cd recorder
python3 -m http.server 8000
```

Open http://localhost:8000 in Chrome (or Edge). A secure context
(localhost/https) is required for the capture APIs.

## Notes

- To capture **system sound**, choose a **Chrome tab** in the share dialog and
  tick **“Also share tab audio”**. macOS does not expose system audio for
  full-screen/window capture.
- The compositor draw loop is driven by a Web Worker timer, so recording keeps
  running at full frame rate while the app tab is in the background.
- Chrome's native "Stop sharing" bar ends the recording gracefully — you land
  on the preview with the recording intact.
