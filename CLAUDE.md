# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

X-Recorder — a browser-based screen & camera recorder (Clipchamp-style). Records the screen with the laptop camera composited as a draggable/resizable picture-in-picture bubble burned into the output, mixes mic + system audio, and exports MP4 (H.264/AAC) at selectable resolution and frame rate. Vanilla HTML/CSS/JS, plain ES modules, **no build step, no dependencies**.

## Running & testing

There is no build, lint, or test suite. It is served as static files:

```sh
python3 serve.py 8000      # no-cache static server (preferred)
# or: python3 -m http.server 8000
```

Open `http://localhost:8000` in **Chrome** (primary target). A secure context (localhost or https) is mandatory — `getDisplayMedia`/`MediaRecorder` will not run over `file://`.

- **Always serve via `serve.py`, not `python3 -m http.server`.** The plain server lets the browser cache JS/CSS, so edits silently don't appear; `serve.py` sends `Cache-Control: no-cache`. The stylesheet link is also versioned (`style.css?v=N`) — bump `N` in `index.html` when a CSS change must be forced.
- **Verification is manual, in a real browser.** There are no automated tests. Drive Chrome (e.g. via Playwright MCP): take screenshots, watch the console, and re-import exported media files to confirm they play. Many behaviors (background-tab recording, codec compatibility, audio mixing, drag) can only be validated this way.

## Architecture

ES modules under `js/`, wired together by `main.js`. The app is a state machine: `SETUP → ACQUIRING → COUNTDOWN → RECORDING ⇄ PAUSED → PREVIEW`.

The load-bearing ideas that span multiple files:

- **The canvas IS the recording (WYSIWYG).** `compositor.js` draws the screen full-frame plus the clipped camera bubble onto one `<canvas>`, which is simultaneously the live on-screen preview and the recorded surface (`canvas.captureStream()`). There is no separate render path — anything you see (bubble position, size, shape, hide) is exactly what gets recorded, live.

- **The draw loop is driven by a Web Worker tick, NOT `requestAnimationFrame`.** `tick-worker.js` posts a ~33ms tick that drives `compositor.draw()`. This is deliberate and must not be "simplified" to rAF: rAF freezes in backgrounded tabs, which is precisely when the user has switched to the tab they're recording — rAF would freeze the recording. Keep the worker.

- **Bubble state is single-source-of-truth and normalized.** `compositor.js` owns `bubble = {x, y, w, shape, visible}` in 0..1 fractions of the canvas. `bubble.js` mutates that same object from two input surfaces — the setup-screen mockup (`#setupStage`/`#setupBubble`) and the recording overlay (`#bubbleOverlay`) — so the position chosen before recording carries straight through. Normalized coords make CSS scaling of the canvas irrelevant.

- **Audio mixing keeps tracks alive.** `audio-mixer.js` routes mic + system-audio sources each through a `GainNode` into one `MediaStreamAudioDestinationNode`. Mute sets gain to 0 (track stays live → seamless mid-recording toggle); the graph is never connected to `ctx.destination` (would echo system audio). System source is created only if the screen stream actually has an audio track.

- **MP4 export is a second-pass re-encode, in-browser.** Recording produces WebM (`recorder.js`, VP9/Opus, codec-negotiated). `exporter.js` then plays the WebM through a hidden `<video>`, redraws scaled frames onto a canvas, and captures with a second `MediaRecorder` using an **`avc1` H.264** mimeType. Runs in real time (≈ recording length). Returns `{promise, cancel}`.

### Pitfalls baked into the code (don't regress these)

- **MP4 must be `avc1`, never `avc3`.** QuickTime/AVFoundation cannot play `avc3` (in-band parameter sets) — files open with "media isn't compatible". Chrome logs a harmless console warning about `avc1` codec-description changes during export; that warning is expected and the file is valid (verified against `avmediainfo`/`ffprobe`). Do not switch to `avc3` to silence it.
- The MP4 export `MediaRecorder` uses **no timeslice** (`recorder.start()` with no arg) — per-slice flushing makes the `avc1` muxer complain.
- **WebM Infinity-duration bug:** Chrome's `MediaRecorder` writes no duration metadata, so previews report `Infinity` and seeking breaks. `ui.js` works around it by seeking to `1e101` then back to 0 on `loadedmetadata`. `exporter.js` does the same before reading duration.
- **`startFlow()` is re-entrancy guarded** by the state machine (`if (app.state !== 'SETUP') return`) — a second Start click during permission prompts would otherwise start two recordings.
- **`releaseAll()` in `main.js` is the single teardown path** (stop/cancel/reset/error). Leaked tracks keep the camera light on — route all cleanup through it.
- Native "Stop sharing" (browser bar) fires `ended` on the screen track → handled as a normal stop, never loses the recording. Camera `ended` (unplugged) just hides the bubble and keeps recording.

### Module map

`main.js` orchestration/state · `capture.js` getDisplayMedia/getUserMedia + device enum + error mapping · `compositor.js` canvas compositing + bubble state · `tick-worker.js` worker timer · `audio-mixer.js` Web Audio mix · `recorder.js` MediaRecorder/WebM · `exporter.js` WebM→MP4 transcode · `bubble.js` drag/resize on both surfaces · `ui.js` screen transitions, countdown, timer, preview.

## Deploy

Pure static files — host anywhere with HTTPS (GitHub Pages, Netlify, Cloudflare Pages). `x-recorder.zip` is the packaged build (gitignored). Origin: `github.com/David0806SG/x-recorder` (private).

## Conventions

Match existing style: small focused ES modules with a clear export surface, terse comments only where behavior is non-obvious (the worker loop, the avc1/QuickTime constraint, the duration hack). No framework idioms — plain DOM and native media APIs throughout.
