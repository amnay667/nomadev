import { EFFECTS } from "../effects/EffectRegistry";

export type VisionToggleKind = "face" | "hands" | "motion";

export interface ControlsCallbacks {
  onSelectEffect: (id: string) => void;
  onToggleVision: (kind: VisionToggleKind, enabled: boolean) => void;
  onSnapshot: () => void;
  onStart: () => void;
}

const VISION_TOGGLES: { kind: VisionToggleKind; label: string }[] = [
  { kind: "face", label: "👁 Face Mesh" },
  { kind: "hands", label: "✋ Hand Trails" },
  { kind: "motion", label: "🌊 Motion Energy" },
];

/**
 * Owns all DOM wiring for the control panel + start screen. Pure UI glue —
 * no camera/GL/vision logic lives here.
 */
export class Controls {
  private readonly effectGroup = document.getElementById("effect-group")!;
  private readonly visionGroup = document.getElementById("vision-group")!;
  private readonly snapshotBtn = document.getElementById("btn-snapshot")! as HTMLButtonElement;
  private readonly startBtn = document.getElementById("btn-start")! as HTMLButtonElement;
  private readonly statusEl = document.getElementById("status")!;
  private readonly statusText = document.getElementById("status-text")!;
  private readonly spinner = document.getElementById("status-spinner")!;
  private readonly fpsBadge = document.getElementById("fps-badge")!;

  private effectButtons = new Map<string, HTMLButtonElement>();
  private toggleButtons = new Map<VisionToggleKind, HTMLButtonElement>();

  constructor(private readonly callbacks: ControlsCallbacks) {
    this.buildEffectButtons();
    this.buildVisionToggles();
    this.snapshotBtn.addEventListener("click", () => this.callbacks.onSnapshot());
    this.startBtn.addEventListener("click", () => {
      this.startBtn.disabled = true;
      this.spinner.classList.add("show");
      this.statusText.textContent = "Requesting camera access…";
      this.callbacks.onStart();
    });
  }

  private buildEffectButtons(): void {
    EFFECTS.forEach((effect, i) => {
      const btn = document.createElement("button");
      btn.textContent = effect.label;
      btn.className = i === 0 ? "active" : "";
      btn.addEventListener("click", () => {
        this.setActiveEffect(effect.id);
        this.callbacks.onSelectEffect(effect.id);
      });
      this.effectGroup.appendChild(btn);
      this.effectButtons.set(effect.id, btn);
    });
  }

  private buildVisionToggles(): void {
    for (const { kind, label } of VISION_TOGGLES) {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = "toggle";
      btn.addEventListener("click", () => {
        const enabled = !btn.classList.contains("on");
        btn.classList.toggle("on", enabled);
        this.callbacks.onToggleVision(kind, enabled);
      });
      this.visionGroup.appendChild(btn);
      this.toggleButtons.set(kind, btn);
    }
  }

  setActiveEffect(id: string): void {
    for (const [effectId, btn] of this.effectButtons) {
      btn.classList.toggle("active", effectId === id);
    }
  }

  setVisionAvailability(available: boolean): void {
    if (available) return;
    // Motion Energy is plain frame-differencing and has no dependency on
    // the MediaPipe models, so it stays enabled even when they can't load.
    for (const kind of ["face", "hands"] as VisionToggleKind[]) {
      const btn = this.toggleButtons.get(kind);
      if (!btn) continue;
      btn.disabled = true;
      btn.title = "Vision models unavailable (offline or blocked network).";
    }
  }

  showError(message: string): void {
    this.statusEl.classList.remove("hidden");
    this.spinner.classList.remove("show");
    this.statusText.textContent = message;
    this.startBtn.disabled = false;
    this.startBtn.textContent = "▶ Try Again";
  }

  hideStartScreen(): void {
    this.statusEl.classList.add("hidden");
  }

  updateFps(fps: number): void {
    this.fpsBadge.textContent = `${fps} fps`;
  }
}
