const GRID_W = 48;
const GRID_H = 27;

/**
 * Coarse frame-differencing "motion energy" field: no external model, just
 * a downsampled luminance diff per grid cell with exponential decay so
 * recent motion glows and fades like a heat trail.
 */
export class MotionEnergy {
  private readonly sampleCanvas: HTMLCanvasElement;
  private readonly sampleCtx: CanvasRenderingContext2D;
  private prevLuma: Float32Array | null = null;
  private energy = new Float32Array(GRID_W * GRID_H);

  constructor() {
    this.sampleCanvas = document.createElement("canvas");
    this.sampleCanvas.width = GRID_W;
    this.sampleCanvas.height = GRID_H;
    const ctx = this.sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D context unavailable for motion sampling canvas.");
    this.sampleCtx = ctx;
    this.sampleCtx.imageSmoothingEnabled = true;
  }

  update(video: HTMLVideoElement): void {
    if (video.readyState < 2) return;
    this.sampleCtx.drawImage(video, 0, 0, GRID_W, GRID_H);
    const { data } = this.sampleCtx.getImageData(0, 0, GRID_W, GRID_H);

    const luma = new Float32Array(GRID_W * GRID_H);
    for (let i = 0; i < GRID_W * GRID_H; i++) {
      const o = i * 4;
      luma[i] = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) / 255;
    }

    if (this.prevLuma) {
      for (let i = 0; i < luma.length; i++) {
        const diff = Math.abs(luma[i] - this.prevLuma[i]);
        const impulse = diff * 4.0;
        this.energy[i] = Math.max(impulse, this.energy[i] * 0.86);
      }
    }
    this.prevLuma = luma;
  }

  /** Draws the motion field onto a 2D overlay canvas, mirrored to match the selfie-flipped video. */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
    const cellW = width / GRID_W;
    const cellH = height / GRID_H;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const e = this.energy[gy * GRID_W + gx];
        if (e < 0.03) continue;
        const alpha = Math.min(e, 1);
        // Mirror x to stay in registration with the horizontally-flipped video.
        const mirroredGx = GRID_W - 1 - gx;
        const cx = (mirroredGx + 0.5) * cellW;
        const cy = (gy + 0.5) * cellH;
        const hue = 190 + 140 * Math.min(e, 1) + 20 * Math.sin(time * 2 + gx);
        const r = Math.max(cellW, cellH) * (0.6 + alpha * 0.9);

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `hsla(${hue}, 95%, 65%, ${alpha * 0.55})`);
        grad.addColorStop(1, `hsla(${hue}, 95%, 55%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
