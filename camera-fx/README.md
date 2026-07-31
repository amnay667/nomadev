# Argus — Live Camera Vision Engine

A real-time, fully client-side virtual camera. Background segmentation,
face mesh, full-body posture coaching, hand/gesture tracking, an air
instrument, pinch-to-draw, and recording all run as WebGL2 + WASM/GPU
inference inside your browser tab. No frame, image, or landmark is ever
sent to a server; the camera stream never leaves `localhost` (or wherever
you deploy the static build).

## What it does

- **Background segmentation** (`src/vision/SegmentationEngine.ts`,
  composited in `GLRenderer`) — MediaPipe's selfie-segmentation model
  produces a live person-confidence mask; the camera feed is rendered
  offscreen and composited against a background layer using that mask, so
  you get a real virtual-background: Off / **Blur** (two-pass separable
  Gaussian) / **Green Screen** (solid colour) / **Replace** (any image you
  upload, cover-fit cropped to the frame).

- **On-device vision** (`src/vision/VisionEngine.ts`,
  `src/overlay/VisionOverlay.ts`) — [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
  runs a 478-point face mesh and a hand + gesture recognizer entirely in WASM/GPU:
  - **Face Mesh** draws the live tesselation + face oval + irises, plus a
    pulsing "third eye" glyph anchored to the glabella landmark.
  - **Hand Trails + Gestures** draws the hand skeleton and spawns a particle
    system at each of the five fingertip landmarks — a physically-simulated
    spark trail (gravity, drag, radial-gradient glow, `lighter` blend mode).
    The same model classifies canned gestures, which double as a hands-free
    remote (see Gesture control below).
  - Model + WASM assets are fetched once from a CDN and cached by the
    browser; inference itself never touches the network. If the assets
    can't be reached (offline, blocked network), the app fails soft — the
    live feed keeps working and the vision toggles just disable
    themselves instead of crashing.

- **Auto Frame** (`src/vision/AutoFrame.ts`) — a Center-Stage-style
  auto-zoom/pan that keeps you centered as you move, computed from the
  same face landmarks (it can run "headless," without the Face Mesh
  visualization). Deliberately implemented as a single CSS `transform`
  (`scale` + `translate`) on a `#frame-wrapper` div containing the video,
  overlay, and draw canvases, rather than remapping UV coordinates inside
  the GL/shader pipeline — because all three layers already live in the
  same screen-space, one shared transform keeps the video, face mesh, hand
  particles, and ink in perfect registration for free, with zero changes
  needed to any of that per-layer drawing code. The crop target is padded
  around the face bounding box and enforces the output aspect ratio, so it
  eases zoom in as you lean back/get smaller in frame and eases back out
  to full width when you're already well-framed, smoothed frame-to-frame
  so it reads as a slow, deliberate follow rather than a snap-to jitter.

- **Air Draw** (`src/overlay/AirDraw.ts`) — with Hand Trails enabled,
  pinching your thumb and index finger together is "pen down": the index
  fingertip draws a persistent ink trail (a real `<canvas>` layer that
  nothing clears each frame, unlike the particle/mesh overlay) until you
  release the pinch. Pinch detection is scale-invariant — the thumb/index
  distance is measured as a fraction of the hand's own size (wrist to
  middle-knuckle), so it works whether your hand is close to or far from
  the camera. Pick a colour from the swatches or clear the canvas from the
  Draw panel (or hands-free, see below).

- **Gesture control** (`src/vision/GestureController.ts`) — with Hand
  Trails enabled, canned gestures drive the app hands-free, edge-triggered
  (must be held ~400ms, and released before re-firing, so a pinned pose
  doesn't spam actions): 🖐️ Open_Palm → snapshot, 👍 Thumb_Up → cycle
  background mode, ✊ Closed_Fist → start/stop recording, ✌️ Victory →
  clear the drawing. A HUD badge shows the currently recognized gesture.

- **Posture Coach** (`src/vision/PostureCoach.ts`) — MediaPipe's
  33-point BlazePose model tracks your ears, shoulders, and hips; the
  ear-to-shoulder distance (as a fraction of shoulder width, so it's
  invariant to body size and camera distance) is calibrated against a
  ~1.5s "sit up straight" baseline the first time you enable it, then every
  subsequent frame is scored against *that specific baseline* rather than
  an absolute threshold. Craning your neck forward/down shrinks that
  distance; uneven shoulder height is checked in parallel. Both are
  debounced (~800ms sustained) before the status badge and colour-coded
  skeleton overlay (teal/yellow/pink) actually change, so a momentary
  shift doesn't flicker the verdict. Hit Recalibrate any time you sit down
  fresh.

- **Air Instrument** (`src/audio/AirInstrument.ts`) — a two-handed
  theremin built entirely on the Web Audio API and the hand landmarks
  already tracked for Hand Trails (no extra model): your first tracked
  hand's height controls pitch (mapped log-scale over two octaves so it
  sounds musical, not linear-in-Hz), a second hand's height controls
  volume, and it fades to silence with no hands up. Every parameter change
  rides on `AudioParam.setTargetAtTime` smoothing so hand-tracking jitter
  never produces zipper noise or clicks. Runs "headless" from Hand Trails
  the same way Auto Frame does with Face Mesh — it only needs the hand
  model running, not the trail visualization.

- **Motion Energy** (`src/overlay/MotionEnergy.ts`) — a from-scratch
  48×27 grid frame-differencing field (no model, just luminance diffing +
  exponential decay) rendered as a glowing heat trail wherever the frame
  is changing. No model dependency, so it works even if the MediaPipe CDN
  is unreachable.

- **Snapshot & Recording** — Snapshot composites the video canvas and the
  vision/particle overlay canvas together and downloads a PNG. Recording
  (`src/core/Recorder.ts`) does the same compositing continuously via
  `canvas.captureStream()` + `MediaRecorder`, downloading a `.webm` clip
  when you stop.

## Architecture

```
src/
  core/
    Camera.ts        getUserMedia wrapper, friendly permission-error messages
    GLRenderer.ts     WebGL2 renderer: single fullscreen triangle, program
                      cache, video texture upload, offscreen render-targets
                      + composite pass for background segmentation
    Recorder.ts       MediaRecorder wrapper over a canvas captureStream()
  shaders/            passthrough.frag.glsl (video -> canvas) plus
                      blur-h/blur-v/composite for background compositing
  vision/
    VisionEngine.ts   MediaPipe FaceLandmarker + GestureRecognizer +
                      PoseLandmarker, lazy init, fails soft if
                      models/network are unavailable
    SegmentationEngine.ts  MediaPipe selfie-segmentation model, same fail-soft contract
    GestureController.ts   debounced, edge-triggered gesture -> action mapping
    AutoFrame.ts      face-bbox -> smoothed (center, zoom) CSS transform
    PostureCoach.ts   calibrated, scale-invariant posture scoring off pose landmarks
  overlay/
    VisionOverlay.ts  draws face mesh / hand skeleton / pose skeleton,
                      "third eye", spawns fingertip particles
    ParticleSystem.ts generic 2D particle physics + additive-blend rendering
    MotionEnergy.ts   frame-differencing motion field
    AirDraw.ts        persistent pinch-to-draw ink layer
  audio/
    AirInstrument.ts  two-handed Web Audio theremin (pitch + volume from hand height)
  ui/
    Controls.ts       all DOM wiring for the control panel / start screen
  utils/
    FPSCounter.ts
  main.ts             wires camera -> renderer -> vision -> segmentation ->
                       gestures -> posture -> instrument -> overlay -> UI,
                       owns the single requestAnimationFrame loop
```

Design choices worth calling out:

- **Mirrored "selfie" view.** The vertex shader flips `vUv.x` once, so the
  feed automatically renders mirrored. Landmark coordinates from MediaPipe
  are in the *raw*, unmirrored video frame, so the overlay mirrors them
  (`x -> 1 - x`) before drawing/spawning particles, keeping the mesh and
  the fingertip trails in perfect registration with what you see.
- **Two UV spaces, on purpose.** The vertex shader emits both `vUv`
  (mirrored, camera-space -- for sampling the raw video texture or the
  segmentation mask, which are fresh/un-mirrored inputs) and `vScreenUv`
  (unflipped, screen-space -- for sampling anything that's itself the
  *output* of an earlier pass in this pipeline: the video render-target, a
  blur pass). Mixing these up flips the sampled content relative to what
  should be on screen; see the comments at the top of `GLRenderer.ts` and
  `composite.frag.glsl` for the full reasoning.
- **Sampler uniforms need `uniform1i`, not `uniform1f`.** Setting a
  `sampler2D` uniform with the float setter is a type mismatch WebGL
  silently rejects (`INVALID_OPERATION`, uniform left unchanged) -- easy to
  miss because a sampler defaults to texture unit 0, so anything meant to
  bind unit 0 looks correct by accident. `GLRenderer` uses a dedicated
  `setSamplerUniform()` (→ `gl.uniform1i`) for every texture uniform to
  avoid it.
- **Everything fails soft.** No camera permission, no WebGL2, no network
  for the vision/segmentation models — each of those degrades a specific
  feature instead of breaking the app.

## Running it

```bash
cd camera-fx
npm install
npm run dev       # http://localhost:5173, needs a real webcam + HTTPS or localhost
```

`npm run build` type-checks with `tsc --noEmit` and produces a static
`dist/` you can host anywhere (`npm run preview` to smoke-test the build
locally). Camera access requires either `localhost` or an HTTPS origin —
that's a browser security requirement, not specific to this app.

## Testing without a physical camera

`test/generate-fake-camera.mjs` writes a synthetic Y4M clip (a drifting
skin-tone "face" blob with eyes/mouth over a shifting gradient — no ffmpeg
or external assets needed) and `test/e2e.mjs` drives a real headless
Chromium against it via `--use-file-for-fake-video-capture`, exercising
the live feed, vision toggles, every background mode, Air Draw, Auto
Frame, Posture Coach, the Air Instrument, and recording:

```bash
npm run build
npm run test:e2e:fixture   # writes test/fixtures/fake-cam.y4m (gitignored)
npm run test:e2e           # builds a preview server + drives Chromium against it
```

The test asserts the live feed actually renders a non-uniform frame,
exercises every background mode and the recording flow, and fails on any
unexpected console/page error — network errors from the MediaPipe CDN
being unreachable are treated as expected soft-failure noise, not a test
failure.

Everything that depends on a MediaPipe model (background compositing's
mirrored-vs-screen-space UV bookkeeping, Auto Frame's crop math, Posture
Coach's calibrated scoring, the Air Instrument's pitch/volume mapping) is
checked without depending on that model actually being reachable:
`main.ts` exposes a `window.__argus` debug hook (harmless in normal use)
that lets the test feed synthetic, already-mirrored landmarks straight
into each module and assert on the result directly, or sample the
rendered canvas to confirm
foreground/background land on the correct side of the screen.

## Privacy

Nothing is uploaded, ever. The camera `MediaStream` is only ever piped into
a local `<video>` element and read back into WebGL/Canvas2D on the same
page. Recordings and snapshots are generated and downloaded entirely
client-side. The only network requests this app makes are one-time,
cacheable fetches of the MediaPipe WASM runtime and model weights (static
files, same as loading a font or a script) — never image or video data.
