import type { Landmark } from "./VisionEngine";

// How much wider/taller than the raw face bounding box the crop window
// should be, so framing includes hair/forehead and a little shoulder room
// instead of a tight eyes-to-chin crop. Expressed as fractions of face size
// (not multipliers of the padded box -- that was an earlier bug here: a
// 16:9 output is *wide*, so once the padded height needs more than ~56% of
// the frame, aspect-correcting the width to match blows past 1 (full
// frame) and the crop clamps to "no zoom" for almost any normal face size.
// These fractions keep the padded box modest enough that zoom actually has
// room to happen for faces at a normal webcam distance, while still
// growing (more zoom) as a face gets smaller/farther away.
const PAD_X = 1.6; // horizontal box = face width * PAD_X
const PAD_TOP = 0.4; // headroom above the face, as a fraction of face height
const PAD_BOTTOM = 0.7; // room below the face (chin/neck), as a fraction of face height

// Never zoom in tighter than this (fraction of the full frame width) --
// keeps the crop from feeling claustrophobic on a big close-up face.
const MIN_ZOOM_FRACTION = 0.32;

// Per-frame lerp factor: how fast the visible crop chases the target.
// Low = smooth Ken-Burns-style follow instead of a jittery snap.
const SMOOTHING = 0.08;

export interface FrameTransform {
  /** Crop center, as a fraction (0..1) of the full mirrored frame. */
  cx: number;
  cy: number;
  /** Zoom multiplier: 1 = full frame, >1 = zoomed in. */
  zoom: number;
}

const IDENTITY: FrameTransform = { cx: 0.5, cy: 0.5, zoom: 1 };

/**
 * Computes a smoothed "center on the face" crop transform from face
 * landmarks. Deliberately produces plain (cx, cy, zoom) numbers meant to
 * drive a CSS transform on the layer stack (see main.ts) rather than
 * reaching into the GL/shader pipeline -- every layer (video, face mesh,
 * particles, ink) already lives in the same screen-space canvases, so a
 * single shared CSS transform keeps all of them in perfect registration
 * for free, with no coordinate remapping needed anywhere else.
 */
export class AutoFrame {
  private current: FrameTransform = { ...IDENTITY };

  /** `landmarks` should already be mirrored (x -> 1 - x) to match the displayed, selfie-flipped feed. */
  update(landmarks: Landmark[] | null, aspect: number): FrameTransform {
    const target = landmarks && landmarks.length > 0 ? this.computeTarget(landmarks, aspect) : IDENTITY;

    this.current = {
      cx: lerp(this.current.cx, target.cx, SMOOTHING),
      cy: lerp(this.current.cy, target.cy, SMOOTHING),
      zoom: lerp(this.current.zoom, target.zoom, SMOOTHING),
    };
    return this.current;
  }

  reset(): void {
    this.current = { ...IDENTITY };
  }

  private computeTarget(landmarks: Landmark[], aspect: number): FrameTransform {
    let minX = 1,
      maxX = 0,
      minY = 1,
      maxY = 0;
    for (const l of landmarks) {
      if (l.x < minX) minX = l.x;
      if (l.x > maxX) maxX = l.x;
      if (l.y < minY) minY = l.y;
      if (l.y > maxY) maxY = l.y;
    }

    const faceW = maxX - minX;
    const faceH = maxY - minY;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // Pad asymmetrically (more room below for shoulders, less above).
    let boxW = faceW * PAD_X;
    let boxH = faceH * (1 + PAD_TOP + PAD_BOTTOM);

    // Enforce the output aspect ratio so the crop never stretches the image.
    if (boxW / boxH > aspect) boxH = boxW / aspect;
    else boxW = boxH * aspect;

    boxW = Math.max(boxW, MIN_ZOOM_FRACTION);
    boxH = boxW / aspect;
    boxW = Math.min(boxW, 1);
    boxH = Math.min(boxH, 1);

    const zoom = 1 / boxW;

    // Clamp the center so the crop window never runs off the edge of the frame.
    const halfW = boxW / 2;
    const halfH = boxH / 2;
    const clampedCx = clamp(cx, halfW, 1 - halfW);
    const clampedCy = clamp(cy, halfH, 1 - halfH);

    return { cx: clampedCx, cy: clampedCy, zoom };
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
