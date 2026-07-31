export type GestureAction = "snapshot" | "cycle-background" | "toggle-recording" | "clear-drawing";

// Open_Palm is deliberately NOT mapped to anything: it's what a hand looks
// like just resting open in frame (mid-wave, about to pinch-draw, etc.), so
// binding an action to it fires constantly by accident. Every gesture here
// is a distinctive, deliberate hand shape you wouldn't make in passing.
const GESTURE_ACTIONS: Record<string, GestureAction> = {
  ILoveYou: "snapshot",
  Thumb_Up: "cycle-background",
  Closed_Fist: "toggle-recording",
  Victory: "clear-drawing",
};

// How long a gesture must be held before it fires (filters single-frame noise).
const HOLD_MS = 400;
// Minimum time between two firings of the *same action*, even if the hand
// briefly drops to "None" and comes back -- classifier flicker on a noisy
// frame shouldn't be enough to re-arm and spam an action.
const ACTION_COOLDOWN_MS = 1800;

/**
 * Turns raw per-frame gesture classifications into discrete, edge-triggered
 * actions: a gesture must be *held* for HOLD_MS and must have been preceded
 * by "None" (hand released/relaxed) before it can fire again, so pinning a
 * pose doesn't spam the same action every frame. A per-action cooldown adds
 * a second layer of protection against rapid re-fires from tracking noise.
 */
export class GestureController {
  private currentGesture: string | null = null;
  private since = 0;
  private lastFired: string | null = null;
  private lastAction: { action: GestureAction; at: number } | null = null;
  private lastFiredAt: Partial<Record<GestureAction, number>> = {};

  update(gestureNames: string[], nowMs: number): GestureAction | null {
    // With multiple hands, take whichever gesture isn't "None"/absent.
    const active = gestureNames.find((g) => g && g !== "None") ?? null;

    if (active !== this.currentGesture) {
      this.currentGesture = active;
      this.since = nowMs;
    }
    if (active === null) {
      this.lastFired = null;
      return null;
    }

    const held = nowMs - this.since;
    if (held >= HOLD_MS && this.lastFired !== active) {
      this.lastFired = active;
      const action = GESTURE_ACTIONS[active] ?? null;
      if (action) {
        const lastFiredAt = this.lastFiredAt[action] ?? -Infinity;
        if (nowMs - lastFiredAt < ACTION_COOLDOWN_MS) return null;
        this.lastFiredAt[action] = nowMs;
        this.lastAction = { action, at: nowMs };
        return action;
      }
    }
    return null;
  }

  /** For a UI badge: what's the last thing this controller actually fired, and how long ago. */
  get lastFiredAction(): { action: GestureAction; at: number } | null {
    return this.lastAction;
  }

  get activeGesture(): string | null {
    return this.currentGesture;
  }
}
