import type { Landmark } from "../vision/VisionEngine";

const MIN_Y = 0.05;
const MAX_Y = 0.95;
const MIN_FREQ = 220; // A3
const OCTAVES = 2;
const MAX_GAIN = 0.2; // headroom so it never clips/feels harsh
const SMOOTH_SECONDS = 0.06;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export interface InstrumentReading {
  /** Normalized (0..1) wrist height driving pitch, or null if no hand. */
  pitchHandY: number | null;
  /** Normalized (0..1) wrist height driving volume, or null if using the single-hand default. */
  volumeHandY: number | null;
  frequency: number;
  gain: number;
}

/**
 * A two-handed theremin: the first tracked hand's wrist height controls
 * pitch (higher hand = higher note, mapped log-scale over two octaves so it
 * sounds musical rather than linear-in-Hz), the second hand's wrist height
 * controls volume. With only one hand up, volume defaults to a fixed
 * moderate level; with no hands, it fades to silence. All parameter changes
 * ride on `setTargetAtTime` smoothing so hand-tracking jitter doesn't
 * produce zipper noise or clicks.
 */
export class AirInstrument {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;

  get active(): boolean {
    return this.ctx !== null;
  }

  start(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.osc = this.ctx.createOscillator();
    this.osc.type = "sine";
    this.osc.frequency.value = MIN_FREQ;
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 0;
    this.osc.connect(this.gainNode).connect(this.ctx.destination);
    this.osc.start();
  }

  stop(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = this.osc;
    const gainNode = this.gainNode;
    this.ctx = null;
    this.osc = null;
    this.gainNode = null;
    osc?.stop();
    osc?.disconnect();
    gainNode?.disconnect();
    void ctx.close();
  }

  update(handLandmarks: Landmark[][]): InstrumentReading {
    if (!this.ctx || !this.osc || !this.gainNode) {
      return { pitchHandY: null, volumeHandY: null, frequency: MIN_FREQ, gain: 0 };
    }

    let frequency = MIN_FREQ;
    let gain = 0;
    let pitchHandY: number | null = null;
    let volumeHandY: number | null = null;

    if (handLandmarks.length > 0) {
      const wrist = handLandmarks[0][0];
      pitchHandY = clamp(wrist.y, MIN_Y, MAX_Y);
      const t = 1 - (pitchHandY - MIN_Y) / (MAX_Y - MIN_Y);
      frequency = MIN_FREQ * Math.pow(2, t * OCTAVES);

      if (handLandmarks.length > 1) {
        const volWrist = handLandmarks[1][0];
        volumeHandY = clamp(volWrist.y, MIN_Y, MAX_Y);
        gain = 1 - (volumeHandY - MIN_Y) / (MAX_Y - MIN_Y);
      } else {
        gain = 0.6;
      }
    }

    const now = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(frequency, now, SMOOTH_SECONDS);
    this.gainNode.gain.setTargetAtTime(gain * MAX_GAIN, now, SMOOTH_SECONDS + 0.02);

    return { pitchHandY, volumeHandY, frequency, gain };
  }
}
