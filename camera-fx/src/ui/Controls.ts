import type { BackgroundMode } from "../core/GLRenderer";

export type VisionToggleKind = "face" | "hands" | "motion";

export interface ControlsCallbacks {
  onToggleVision: (kind: VisionToggleKind, enabled: boolean) => void;
  onSelectBackground: (mode: BackgroundMode) => void;
  onBackgroundImageFile: (file: File) => void;
  onSelectDrawColor: (color: string) => void;
  onClearDrawing: () => void;
  onSnapshot: () => void;
  onToggleRecord: () => void;
  onStart: () => void;
}

const VISION_TOGGLES: { kind: VisionToggleKind; label: string }[] = [
  { kind: "face", label: "👁 Face Mesh" },
  { kind: "hands", label: "✋ Hand Trails + Gestures" },
  { kind: "motion", label: "🌊 Motion Energy" },
];

const BACKGROUND_MODES: { mode: BackgroundMode; label: string }[] = [
  { mode: "off", label: "Off" },
  { mode: "blur", label: "🌫 Blur" },
  { mode: "color", label: "🟢 Green Screen" },
  { mode: "image", label: "🖼 Replace…" },
];

const DRAW_COLORS = ["#5eead4", "#f472b6", "#facc15", "#f8fafc", "#38bdf8"];

/**
 * Owns all DOM wiring for the control panel + start screen. Pure UI glue —
 * no camera/GL/vision logic lives here.
 */
export class Controls {
  private readonly visionGroup = document.getElementById("vision-group")!;
  private readonly backgroundGroup = document.getElementById("background-group")!;
  private readonly drawGroup = document.getElementById("draw-group")!;
  private readonly drawClearBtn = document.getElementById("btn-draw-clear")! as HTMLButtonElement;
  private readonly snapshotBtn = document.getElementById("btn-snapshot")! as HTMLButtonElement;
  private readonly recordBtn = document.getElementById("btn-record")! as HTMLButtonElement;
  private readonly bgImageInput = document.getElementById("bg-image-input")! as HTMLInputElement;
  private readonly startBtn = document.getElementById("btn-start")! as HTMLButtonElement;
  private readonly statusEl = document.getElementById("status")!;
  private readonly statusText = document.getElementById("status-text")!;
  private readonly spinner = document.getElementById("status-spinner")!;
  private readonly fpsBadge = document.getElementById("fps-badge")!;
  private readonly gestureBadge = document.getElementById("gesture-badge")!;

  private toggleButtons = new Map<VisionToggleKind, HTMLButtonElement>();
  private backgroundButtons = new Map<BackgroundMode, HTMLButtonElement>();
  private colorButtons = new Map<string, HTMLButtonElement>();

  constructor(private readonly callbacks: ControlsCallbacks) {
    this.buildVisionToggles();
    this.buildBackgroundButtons();
    this.buildDrawColorButtons();

    this.drawClearBtn.addEventListener("click", () => this.callbacks.onClearDrawing());
    this.snapshotBtn.addEventListener("click", () => this.callbacks.onSnapshot());
    this.recordBtn.addEventListener("click", () => this.callbacks.onToggleRecord());
    this.bgImageInput.addEventListener("change", () => {
      const file = this.bgImageInput.files?.[0];
      if (file) this.callbacks.onBackgroundImageFile(file);
      this.bgImageInput.value = "";
    });
    this.startBtn.addEventListener("click", () => {
      this.startBtn.disabled = true;
      this.spinner.classList.add("show");
      this.statusText.textContent = "Requesting camera access…";
      this.callbacks.onStart();
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

  private buildBackgroundButtons(): void {
    for (const { mode, label } of BACKGROUND_MODES) {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = mode === "off" ? "active" : "";
      btn.addEventListener("click", () => {
        if (mode === "image") {
          this.bgImageInput.click();
          return;
        }
        this.setActiveBackground(mode);
        this.callbacks.onSelectBackground(mode);
      });
      this.backgroundGroup.appendChild(btn);
      this.backgroundButtons.set(mode, btn);
    }
  }

  private buildDrawColorButtons(): void {
    DRAW_COLORS.forEach((color, i) => {
      const btn = document.createElement("button");
      btn.className = i === 0 ? "swatch active" : "swatch";
      btn.style.background = color;
      btn.title = color;
      btn.addEventListener("click", () => {
        this.setActiveDrawColor(color);
        this.callbacks.onSelectDrawColor(color);
      });
      this.drawGroup.insertBefore(btn, this.drawClearBtn);
      this.colorButtons.set(color, btn);
    });
  }

  setActiveDrawColor(color: string): void {
    for (const [c, btn] of this.colorButtons) {
      btn.classList.toggle("active", c === color);
    }
  }

  setActiveBackground(mode: BackgroundMode): void {
    for (const [m, btn] of this.backgroundButtons) {
      btn.classList.toggle("active", m === mode);
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

  setBackgroundAvailability(available: boolean): void {
    if (available) return;
    // "Off" needs no segmentation model, so it stays usable either way.
    for (const mode of ["blur", "color", "image"] as BackgroundMode[]) {
      const btn = this.backgroundButtons.get(mode);
      if (!btn) continue;
      btn.disabled = true;
      btn.title = "Segmentation model unavailable (offline or blocked network).";
    }
  }

  setRecording(recording: boolean): void {
    this.recordBtn.classList.toggle("recording", recording);
    this.recordBtn.textContent = recording ? "⏹ Stop" : "⏺ Record";
  }

  setGesture(name: string | null): void {
    if (!name || name === "None") {
      this.gestureBadge.style.display = "none";
      return;
    }
    this.gestureBadge.style.display = "";
    this.gestureBadge.textContent = `✋ ${name.replace(/_/g, " ")}`;
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
