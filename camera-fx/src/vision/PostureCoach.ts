import type { Landmark } from "./VisionEngine";

// BlazePose 33-point indices.
const LEFT_EAR = 7;
const RIGHT_EAR = 8;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

const CALIBRATION_FRAMES = 45; // ~1.5s at 30fps of "sit up straight" baseline capture
const WARN_REL = 0.9; // ear-to-shoulder distance shrunk >10% vs. baseline
const BAD_REL = 0.8; // shrunk >20% vs. baseline -- head noticeably dropping/craning forward
const TILT_WARN = 0.1; // shoulder height difference, as a fraction of shoulder width
const TILT_BAD = 0.18;
const HOLD_MS = 800; // debounce: a status must be sustained this long before it's reported

export type PostureStatus = "calibrating" | "none" | "good" | "warn" | "bad";

export interface PostureReading {
  status: PostureStatus;
  relScore: number | null;
  tilt: number | null;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Scale-invariant posture scoring: calibrates a "good posture" baseline
 * (the ear-to-shoulder distance as a fraction of shoulder width, which
 * shrinks as you crane your neck forward/down) from the first ~1.5s after
 * enabling or recalibrating, then compares every subsequent frame against
 * that baseline instead of an absolute threshold -- works regardless of
 * body proportions or distance from the camera, since both the baseline
 * and the live reading are normalized by the same person's own shoulder
 * width. Shoulder tilt (uneven shoulder heights) is checked in parallel.
 */
export class PostureCoach {
  private samples: number[] = [];
  private baselineRatio: number | null = null;
  private candidate: PostureStatus = "calibrating";
  private candidateSince = 0;
  private displayed: PostureStatus = "calibrating";

  recalibrate(): void {
    this.samples = [];
    this.baselineRatio = null;
    this.candidate = "calibrating";
    this.displayed = "calibrating";
  }

  update(landmarks: Landmark[] | null, nowMs: number): PostureReading {
    if (!landmarks || landmarks.length === 0) {
      return this.settle("none", nowMs, null, null);
    }

    const leftEar = landmarks[LEFT_EAR];
    const rightEar = landmarks[RIGHT_EAR];
    const leftShoulder = landmarks[LEFT_SHOULDER];
    const rightShoulder = landmarks[RIGHT_SHOULDER];
    if (!leftEar || !rightEar || !leftShoulder || !rightShoulder) {
      return this.settle("none", nowMs, null, null);
    }

    const shoulderWidth = dist(leftShoulder, rightShoulder) || 0.001;
    const earMid = { x: (leftEar.x + rightEar.x) / 2, y: (leftEar.y + rightEar.y) / 2 };
    const shoulderMid = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 };
    const ratio = dist(earMid, shoulderMid) / shoulderWidth;
    const tilt = Math.abs(leftShoulder.y - rightShoulder.y) / shoulderWidth;

    if (this.baselineRatio === null) {
      this.samples.push(ratio);
      if (this.samples.length >= CALIBRATION_FRAMES) {
        this.baselineRatio = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
      }
      this.candidate = "calibrating";
      this.candidateSince = nowMs;
      this.displayed = "calibrating";
      return { status: "calibrating", relScore: null, tilt };
    }

    const relScore = ratio / this.baselineRatio;
    let candidate: PostureStatus;
    if (relScore < BAD_REL || tilt > TILT_BAD) candidate = "bad";
    else if (relScore < WARN_REL || tilt > TILT_WARN) candidate = "warn";
    else candidate = "good";

    return this.settle(candidate, nowMs, relScore, tilt);
  }

  private settle(candidate: PostureStatus, nowMs: number, relScore: number | null, tilt: number | null): PostureReading {
    if (candidate !== this.candidate) {
      this.candidate = candidate;
      this.candidateSince = nowMs;
    }
    if (nowMs - this.candidateSince >= HOLD_MS) {
      this.displayed = candidate;
    }
    return { status: this.displayed, relScore, tilt };
  }
}
