import { Camera, CameraError } from "./core/Camera";
import { GLRenderer, type BackgroundMode } from "./core/GLRenderer";
import { Recorder } from "./core/Recorder";
import { VisionEngine } from "./vision/VisionEngine";
import { SegmentationEngine } from "./vision/SegmentationEngine";
import { GestureController, type GestureAction } from "./vision/GestureController";
import { VisionOverlay } from "./overlay/VisionOverlay";
import { MotionEnergy } from "./overlay/MotionEnergy";
import { AirDraw } from "./overlay/AirDraw";
import { FPSCounter } from "./utils/FPSCounter";
import { Controls, type VisionToggleKind } from "./ui/Controls";

const videoEl = document.getElementById("source") as HTMLVideoElement;
const glCanvas = document.getElementById("gl-canvas") as HTMLCanvasElement;
const overlayCanvas = document.getElementById("overlay-canvas") as HTMLCanvasElement;
const drawCanvas = document.getElementById("draw-canvas") as HTMLCanvasElement;
const stage = glCanvas.parentElement as HTMLElement;
const overlayCtx = overlayCanvas.getContext("2d")!;

const camera = new Camera({ video: videoEl });
const renderer = new GLRenderer(glCanvas);
const vision = new VisionEngine();
const segmentation = new SegmentationEngine();
const gestureController = new GestureController();
const visionOverlay = new VisionOverlay();
const motionEnergy = new MotionEnergy();
const airDraw = new AirDraw(drawCanvas);
const fps = new FPSCounter();
const recorder = new Recorder();

// A hidden canvas continuously redrawn (gl-canvas + overlay-canvas merged)
// only while recording, so MediaRecorder has a single source to capture.
const recordCanvas = document.createElement("canvas");
const recordCtx = recordCanvas.getContext("2d")!;

let motionEnabled = false;
let running = false;
let isRecording = false;
let lastFrameTime = performance.now();

function resize(): void {
  const rect = stage.getBoundingClientRect();
  renderer.resize(rect.width, rect.height);
  overlayCanvas.width = glCanvas.width;
  overlayCanvas.height = glCanvas.height;
  // Resizing a canvas clears it, and drawCanvas holds persistent ink -- only
  // touch it when the size actually changed, so redundant resize() calls
  // (e.g. a spurious window "resize" event) don't wipe a drawing.
  if (drawCanvas.width !== glCanvas.width || drawCanvas.height !== glCanvas.height) {
    drawCanvas.width = glCanvas.width;
    drawCanvas.height = glCanvas.height;
  }
  recordCanvas.width = glCanvas.width;
  recordCanvas.height = glCanvas.height;
}

function setBackgroundMode(mode: BackgroundMode): void {
  renderer.backgroundMode = mode;
  controls.setActiveBackground(mode);
  if (mode === "off") {
    segmentation.enabled = false;
    return;
  }
  segmentation.enabled = true;
  void segmentation.ensureInit().then(() => {
    if (segmentation.status === "unavailable") controls.setBackgroundAvailability(false);
  });
}

function cycleBackground(): void {
  const order: BackgroundMode[] = ["off", "blur", "color"];
  const idx = order.indexOf(renderer.backgroundMode === "image" ? "off" : renderer.backgroundMode);
  setBackgroundMode(order[(idx + 1) % order.length]);
}

async function toggleRecording(): Promise<void> {
  if (isRecording) {
    isRecording = false;
    controls.setRecording(false);
    const blob = await recorder.stop();
    if (blob) {
      const link = document.createElement("a");
      link.download = `argus-recording-${Date.now()}.webm`;
      link.href = URL.createObjectURL(blob);
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    }
  } else {
    recordCanvas.width = glCanvas.width;
    recordCanvas.height = glCanvas.height;
    recorder.start(recordCanvas, 30);
    isRecording = true;
    controls.setRecording(true);
  }
}

function handleGestureAction(action: GestureAction): void {
  switch (action) {
    case "snapshot":
      takeSnapshot();
      break;
    case "cycle-background":
      cycleBackground();
      break;
    case "toggle-recording":
      void toggleRecording();
      break;
    case "clear-drawing":
      airDraw.clear();
      break;
  }
}

function tick(now: number): void {
  requestAnimationFrame(tick);
  if (!running) return;

  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  const timeSec = now / 1000;

  renderer.uploadVideoFrame(videoEl);

  if (renderer.backgroundMode !== "off" && segmentation.enabled) {
    const mask = segmentation.update(videoEl, now);
    if (mask) renderer.uploadMask(mask.data, mask.width, mask.height);
  }
  renderer.render();

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (motionEnabled) {
    motionEnergy.update(videoEl);
    motionEnergy.draw(overlayCtx, overlayCanvas.width, overlayCanvas.height, timeSec);
  }

  if (vision.faceEnabled || vision.handsEnabled) {
    const frame = vision.update(videoEl, now);
    visionOverlay.render(overlayCtx, frame, overlayCanvas.width, overlayCanvas.height, timeSec, dt);

    if (vision.handsEnabled) {
      airDraw.update(frame.handLandmarks, overlayCanvas.width, overlayCanvas.height);
      controls.setGesture(gestureController.activeGesture);
      const action = gestureController.update(frame.gestures, now);
      if (action) handleGestureAction(action);
    }
  }

  if (isRecording) {
    recordCtx.drawImage(glCanvas, 0, 0);
    recordCtx.drawImage(overlayCanvas, 0, 0);
    recordCtx.drawImage(drawCanvas, 0, 0);
  }

  fps.tick();
  controls.updateFps(fps.fps);
}

const controls = new Controls({
  onToggleVision: (kind: VisionToggleKind, enabled: boolean) => {
    if (kind === "motion") {
      motionEnabled = enabled;
      return;
    }
    if (kind === "face") vision.faceEnabled = enabled;
    if (kind === "hands") {
      vision.handsEnabled = enabled;
      if (!enabled) controls.setGesture(null);
    }
    if (enabled) void vision.ensureInit();
  },
  onSelectBackground: (mode) => setBackgroundMode(mode),
  onBackgroundImageFile: (file) => void loadBackgroundImage(file),
  onSelectDrawColor: (color) => {
    airDraw.color = color;
  },
  onClearDrawing: () => airDraw.clear(),
  onSnapshot: () => takeSnapshot(),
  onToggleRecord: () => void toggleRecording(),
  onStart: () => void startCamera(),
});

async function loadBackgroundImage(file: File): Promise<void> {
  const bitmap = await createImageBitmap(file);
  // Cover-fit crop into the stage's locked 16:9 aspect so it fills the
  // frame with no letterboxing, matching how the video itself is displayed.
  const targetW = glCanvas.width || 1280;
  const targetH = glCanvas.height || 720;
  const crop = document.createElement("canvas");
  crop.width = targetW;
  crop.height = targetH;
  const ctx = crop.getContext("2d")!;

  const targetAspect = targetW / targetH;
  const srcAspect = bitmap.width / bitmap.height;
  let sx = 0,
    sy = 0,
    sw = bitmap.width,
    sh = bitmap.height;
  if (srcAspect > targetAspect) {
    sw = bitmap.height * targetAspect;
    sx = (bitmap.width - sw) / 2;
  } else {
    sh = bitmap.width / targetAspect;
    sy = (bitmap.height - sh) / 2;
  }
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, targetW, targetH);

  renderer.uploadBackgroundImage(crop);
  setBackgroundMode("image");
}

async function startCamera(): Promise<void> {
  try {
    await camera.start();
    resize();
    running = true;
    controls.hideStartScreen();
    void vision.ensureInit().then(() => {
      if (vision.status === "unavailable") controls.setVisionAvailability(false);
    });
  } catch (err) {
    const message = err instanceof CameraError ? err.message : "Something went wrong starting the camera.";
    controls.showError(message);
  }
}

function takeSnapshot(): void {
  const composite = document.createElement("canvas");
  composite.width = glCanvas.width;
  composite.height = glCanvas.height;
  const ctx = composite.getContext("2d")!;
  ctx.drawImage(glCanvas, 0, 0);
  ctx.drawImage(overlayCanvas, 0, 0);
  ctx.drawImage(drawCanvas, 0, 0);

  const link = document.createElement("a");
  link.download = `argus-${Date.now()}.png`;
  link.href = composite.toDataURL("image/png");
  link.click();
}

window.addEventListener("resize", resize);
requestAnimationFrame(tick);

// Debug/QA hook: lets the e2e test (and manual poking from devtools) drive
// background compositing with a synthetic mask, without depending on the
// segmentation model actually being reachable. No-op for normal usage.
(window as unknown as { __argus: unknown }).__argus = {
  renderer,
  segmentation,
  airDraw,
  setBackgroundMode,
  freezeSegmentation: (frozen: boolean) => {
    segmentation.enabled = !frozen;
  },
  uploadTestMask: (data: Uint8Array, width: number, height: number) => renderer.uploadMask(data, width, height),
  debugReadMask: (x: number, y: number) => renderer.debugReadMask(x, y),
};
