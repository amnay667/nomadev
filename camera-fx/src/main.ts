import { Camera, CameraError } from "./core/Camera";
import { GLRenderer } from "./core/GLRenderer";
import { findEffect } from "./effects/EffectRegistry";
import { VisionEngine } from "./vision/VisionEngine";
import { VisionOverlay } from "./overlay/VisionOverlay";
import { MotionEnergy } from "./overlay/MotionEnergy";
import { FPSCounter } from "./utils/FPSCounter";
import { Controls, type VisionToggleKind } from "./ui/Controls";

const videoEl = document.getElementById("source") as HTMLVideoElement;
const glCanvas = document.getElementById("gl-canvas") as HTMLCanvasElement;
const overlayCanvas = document.getElementById("overlay-canvas") as HTMLCanvasElement;
const stage = glCanvas.parentElement as HTMLElement;
const overlayCtx = overlayCanvas.getContext("2d")!;

const camera = new Camera({ video: videoEl });
const renderer = new GLRenderer(glCanvas);
const vision = new VisionEngine();
const visionOverlay = new VisionOverlay();
const motionEnergy = new MotionEnergy();
const fps = new FPSCounter();

let currentEffectId = "raw";
let motionEnabled = false;
let running = false;
let lastFrameTime = performance.now();

function resize(): void {
  const rect = stage.getBoundingClientRect();
  renderer.resize(rect.width, rect.height);
  overlayCanvas.width = glCanvas.width;
  overlayCanvas.height = glCanvas.height;
}

function tick(now: number): void {
  requestAnimationFrame(tick);
  if (!running) return;

  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  renderer.uploadVideoFrame(videoEl);
  renderer.renderEffect(findEffect(currentEffectId));

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const timeSec = now / 1000;
  if (motionEnabled) {
    motionEnergy.update(videoEl);
    motionEnergy.draw(overlayCtx, overlayCanvas.width, overlayCanvas.height, timeSec);
  }

  if (vision.faceEnabled || vision.handsEnabled) {
    const frame = vision.update(videoEl, now);
    visionOverlay.render(overlayCtx, frame, overlayCanvas.width, overlayCanvas.height, timeSec, dt);
  }

  fps.tick();
  controls.updateFps(fps.fps);
}

const controls = new Controls({
  onSelectEffect: (id) => {
    currentEffectId = id;
  },
  onToggleVision: (kind: VisionToggleKind, enabled: boolean) => {
    if (kind === "motion") {
      motionEnabled = enabled;
      return;
    }
    if (kind === "face") vision.faceEnabled = enabled;
    if (kind === "hands") vision.handsEnabled = enabled;
    if (enabled) void vision.ensureInit();
  },
  onSnapshot: () => takeSnapshot(),
  onStart: () => void startCamera(),
});

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

  const link = document.createElement("a");
  link.download = `argus-${currentEffectId}-${Date.now()}.png`;
  link.href = composite.toDataURL("image/png");
  link.click();
}

window.addEventListener("resize", resize);
requestAnimationFrame(tick);
