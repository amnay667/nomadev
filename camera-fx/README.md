# Argus — Live Camera Vision Engine

A real-time, fully client-side computer-vision playground for your webcam.
Everything — the shader effects, the face mesh, the hand tracking — runs
as WebGL2 + WASM/GPU inference inside your browser tab. No frame, image,
or landmark is ever sent to a server; the camera stream never leaves
`localhost` (or wherever you deploy the static build).

## What it does

- **GLSL shader pipeline** (`src/shaders/*.glsl`) — six full-screen fragment
  shaders sample the live camera texture each frame:
  - `Edge Scan` — Sobel-operator edge detection with a cyan/magenta scanner palette.
  - `Thermal` — false-color FLIR-style palette with a soft blur and sensor grain.
  - `ASCII` — every effect renders in real time; ASCII is entirely
    procedural (signed-distance "glyphs" drawn from math, no font texture).
  - `Datamosh` — row-tearing, chromatic aberration, and a feedback texture
    that lets some rows "fail to update," mimicking corrupted P-frames.
  - `Kaleidoscope` — radial mirror-segmented sampling with a slow rotation.
  - `Night Vision` — cheap multi-tap bloom, green monochrome, grain, and a
    rolling scanline sweep behind a scope-style vignette.

- **On-device vision** (`src/vision/VisionEngine.ts`,
  `src/overlay/VisionOverlay.ts`) — [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
  runs a 478-point face mesh and 21-point hand landmarker entirely in WASM/GPU:
  - **Face Mesh** draws the live tesselation + face oval + irises, plus a
    pulsing "third eye" glyph anchored to the glabella landmark.
  - **Hand Trails** draws the hand skeleton and spawns a particle system at
    each of the five fingertip landmarks — a physically-simulated spark
    trail (gravity, drag, radial-gradient glow, `lighter` blend mode).
  - Model + WASM assets are fetched once from a CDN and cached by the
    browser; inference itself never touches the network. If the assets
    can't be reached (offline, blocked network), the app fails soft — the
    shader pipeline keeps working and the vision toggles just disable
    themselves instead of crashing.

- **Motion Energy** (`src/overlay/MotionEnergy.ts`) — a from-scratch
  48×27 grid frame-differencing field (no model, just luminance diffing +
  exponential decay) rendered as a glowing heat trail wherever the frame
  is changing.

- **Snapshot** — composites the shader canvas and the vision/particle
  overlay canvas together and downloads a PNG.

## Architecture

```
src/
  core/
    Camera.ts        getUserMedia wrapper, friendly permission-error messages
    GLRenderer.ts     WebGL2 renderer: single fullscreen triangle, program
                      cache, video texture upload, "previous frame" feedback
                      texture for trail/datamosh effects
  shaders/            one self-contained GLSL ES 3.00 fragment shader per effect
  effects/
    EffectRegistry.ts maps shader source -> { id, label } effect definitions
  vision/
    VisionEngine.ts   MediaPipe FaceLandmarker + HandLandmarker, lazy init,
                      fails soft if models/network are unavailable
  overlay/
    VisionOverlay.ts  draws face mesh / hand skeleton, "third eye", spawns
                      fingertip particles
    ParticleSystem.ts generic 2D particle physics + additive-blend rendering
    MotionEnergy.ts   frame-differencing motion field
  ui/
    Controls.ts       all DOM wiring for the control panel / start screen
  utils/
    FPSCounter.ts
  main.ts             wires camera -> renderer -> vision -> overlay -> UI,
                       owns the single requestAnimationFrame loop
```

Design choices worth calling out:

- **Mirrored "selfie" view.** The vertex shader flips `vUv.x` once, so every
  shader automatically renders mirrored. Landmark coordinates from MediaPipe
  are in the *raw*, unmirrored video frame, so the overlay mirrors them
  (`x -> 1 - x`) before drawing/spawning particles, keeping the mesh and
  the fingertip trails in perfect registration with what you see.
- **One texture upload per frame, one draw call per effect.** All shaders
  share the same fullscreen-triangle vertex shader (no vertex buffers at
  all — positions come from `gl_VertexID`), and a program cache avoids
  recompiling on every effect switch.
- **Feedback texture, not multi-pass ping-pong.** After every draw, the
  default framebuffer is copied into `uPrevFrame` via `copyTexImage2D`.
  Any shader can opt into trailing/datamosh behavior just by sampling it —
  no render-target plumbing needed for the common case.
- **Everything fails soft.** No camera permission, no WebGL2, no network
  for the vision models — each of those degrades a specific feature
  instead of breaking the app.

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
every shader effect, the vision toggles, and the snapshot action:

```bash
npm run build
npm run test:e2e:fixture   # writes test/fixtures/fake-cam.y4m (gitignored)
npm run test:e2e           # builds a preview server + drives Chromium against it
```

The test asserts each shader effect actually renders a non-uniform frame
(via per-effect luminance mean/stddev), and fails on any unexpected
console/page error — network errors from the MediaPipe CDN being
unreachable are treated as expected soft-failure noise, not a test failure.

## Privacy

Nothing is uploaded, ever. The camera `MediaStream` is only ever piped into
a local `<video>` element and read back into WebGL/Canvas2D on the same
page. The only network requests this app makes are one-time, cacheable
fetches of the MediaPipe WASM runtime and model weights (static files, same
as loading a font or a script) — never image or video data.
