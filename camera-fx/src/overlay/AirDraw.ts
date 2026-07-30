import type { Landmark } from "../vision/VisionEngine";

const THUMB_TIP = 4;
const INDEX_TIP = 8;
const WRIST = 0;
const MIDDLE_MCP = 9;

// Pinch threshold as a fraction of hand size (wrist-to-middle-knuckle
// distance), so it works regardless of how close the hand is to the camera.
const PINCH_RATIO = 0.35;

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface PenState {
  lastX: number | null;
  lastY: number | null;
}

/**
 * Persistent "ink" layer: pinch (thumb tip + index tip touching) is pen-down,
 * the index fingertip is the pen, releasing the pinch lifts the pen. Ink
 * accumulates on its own canvas that nothing else clears each frame, so
 * strokes persist until the user (or a gesture) clears them.
 */
export class AirDraw {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly pens: PenState[] = [{ lastX: null, lastY: null }, { lastX: null, lastY: null }];
  color = "#5eead4";
  lineWidth = 6;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable for the draw canvas.");
    this.ctx = ctx;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
  }

  update(handLandmarks: Landmark[][], width: number, height: number): void {
    handLandmarks.forEach((landmarks, i) => {
      const pen = this.pens[i] ?? (this.pens[i] = { lastX: null, lastY: null });
      const thumb = landmarks[THUMB_TIP];
      const index = landmarks[INDEX_TIP];
      const wrist = landmarks[WRIST];
      const middleMcp = landmarks[MIDDLE_MCP];
      if (!thumb || !index || !wrist || !middleMcp) return;

      const handSize = dist(wrist, middleMcp) || 0.001;
      const pinching = dist(thumb, index) / handSize < PINCH_RATIO;

      // Mirror x to match the selfie-flipped video, same as the rest of the overlay.
      const x = (1 - index.x) * width;
      const y = index.y * height;

      if (pinching) {
        if (pen.lastX !== null && pen.lastY !== null) {
          this.ctx.strokeStyle = this.color;
          this.ctx.lineWidth = this.lineWidth;
          this.ctx.beginPath();
          this.ctx.moveTo(pen.lastX, pen.lastY);
          this.ctx.lineTo(x, y);
          this.ctx.stroke();
        }
        pen.lastX = x;
        pen.lastY = y;
      } else {
        pen.lastX = null;
        pen.lastY = null;
      }
    });

    // Any hand slot that stopped reporting landmarks this frame lifts its pen.
    for (let i = handLandmarks.length; i < this.pens.length; i++) {
      this.pens[i].lastX = null;
      this.pens[i].lastY = null;
    }
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
