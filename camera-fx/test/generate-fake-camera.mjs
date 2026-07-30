// Generates a synthetic Y4M clip standing in for a webcam, so the e2e test
// (and anyone without a physical camera) can drive the app end-to-end via
// Chromium's --use-file-for-fake-video-capture. No ffmpeg/lavfi dependency:
// this writes raw YUV420 frames directly.
import fs from "node:fs";

const W = 640,
  H = 480,
  FPS = 30,
  SECONDS = 8;
const FRAMES = FPS * SECONDS;

const outPath = process.argv[2];
if (!outPath) {
  console.error("Usage: node generate-fake-camera.mjs <output.y4m>");
  process.exit(1);
}

const out = fs.createWriteStream(outPath);
out.write(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);

function rgbToYuv(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const u = -0.169 * r - 0.331 * g + 0.5 * b + 128;
  const v = 0.5 * r - 0.419 * g - 0.081 * b + 128;
  return [y, u, v];
}

// A face-ish blob (skin-tone ellipse with two darker "eyes" + a mouth)
// drifting and pulsing over a moving gradient background -- enough motion
// and luminance variance to meaningfully exercise edge-detection, thermal,
// ASCII, datamosh, kaleidoscope, night-vision, and the frame-differencing
// motion-energy field.
function renderFrame(frameIndex) {
  const t = frameIndex / FPS;
  const Yp = new Uint8Array(W * H);
  const Up = new Uint8Array((W / 2) * (H / 2));
  const Vp = new Uint8Array((W / 2) * (H / 2));

  const cx = W / 2 + Math.sin(t * 0.7) * W * 0.15;
  const cy = H / 2 + Math.cos(t * 0.5) * H * 0.1;
  const rx = 90 + 10 * Math.sin(t * 2.0);
  const ry = 120 + 8 * Math.cos(t * 1.7);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx = x / W,
        gy = y / H;
      let r = 40 + 120 * gx + 40 * Math.sin(t + gy * 3);
      let g = 60 + 80 * gy + 30 * Math.cos(t * 1.3 + gx * 3);
      let b = 90 + 60 * Math.sin(t * 0.6 + gx + gy);

      const dx = (x - cx) / rx,
        dy = (y - cy) / ry;
      if (dx * dx + dy * dy < 1.0) {
        r = 220;
        g = 170;
        b = 140; // skin tone blob
        const eyeYOff = -0.25,
          eyeXOff = 0.35;
        const le = Math.pow((dx - eyeXOff) / 0.18, 2) + Math.pow((dy - eyeYOff) / 0.14, 2);
        const re = Math.pow((dx + eyeXOff) / 0.18, 2) + Math.pow((dy - eyeYOff) / 0.14, 2);
        if (le < 1 || re < 1) {
          r = 20;
          g = 20;
          b = 25;
        }
        const mouth = Math.pow(dx / 0.5, 2) + Math.pow((dy - 0.55) / 0.12, 2);
        if (mouth < 1) {
          r = 140;
          g = 50;
          b = 60;
        }
      }

      const [Y, U, V] = rgbToYuv(
        Math.max(0, Math.min(255, r)),
        Math.max(0, Math.min(255, g)),
        Math.max(0, Math.min(255, b)),
      );
      Yp[y * W + x] = Y;
      if ((x & 1) === 0 && (y & 1) === 0) {
        const ci = (y >> 1) * (W >> 1) + (x >> 1);
        Up[ci] = U;
        Vp[ci] = V;
      }
    }
  }
  return Buffer.concat([Buffer.from(Yp), Buffer.from(Up), Buffer.from(Vp)]);
}

let frame = 0;
function writeNext() {
  if (frame >= FRAMES) {
    out.end();
    return;
  }
  const ok = out.write("FRAME\n") && out.write(renderFrame(frame));
  frame++;
  if (ok) setImmediate(writeNext);
  else out.once("drain", writeNext);
}
writeNext();
out.on("finish", () => console.log(`wrote ${FRAMES} frames to ${outPath}`));
