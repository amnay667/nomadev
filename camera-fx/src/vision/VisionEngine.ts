import {
  FilesetResolver,
  FaceLandmarker,
  HandLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

// Everything here runs as WASM/GPU inference inside the tab. The model
// weights and WASM runtime are static files fetched once from a CDN (same
// origin policy as any <script src> import) and then executed locally —
// no video frame or landmark ever leaves the browser.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type Landmark = NormalizedLandmark;

export interface VisionFrame {
  faceLandmarks: Landmark[][];
  handLandmarks: Landmark[][];
  handedness: string[];
}

export type VisionStatus = "idle" | "loading" | "ready" | "unavailable";

/**
 * Lazily-initialized wrapper around MediaPipe FaceLandmarker + HandLandmarker.
 * Designed to fail soft: if the models can't be fetched (offline, blocked
 * network, no WebGL2 for the delegate, ...) the app keeps working with the
 * shader pipeline alone and vision toggles simply report "unavailable".
 */
export class VisionEngine {
  private faceLandmarker: FaceLandmarker | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private lastFace: FaceLandmarkerResult | null = null;
  private lastHands: HandLandmarkerResult | null = null;
  private initPromise: Promise<void> | null = null;

  status: VisionStatus = "idle";
  faceEnabled = false;
  handsEnabled = false;

  async ensureInit(): Promise<void> {
    if (this.status === "ready" || this.status === "unavailable") return;
    if (this.initPromise) return this.initPromise;

    this.status = "loading";
    this.initPromise = (async () => {
      const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE);

      this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });

      this.handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });

      this.status = "ready";
    })().catch((err) => {
      console.warn("[VisionEngine] models unavailable, continuing shader-only:", err);
      this.status = "unavailable";
    });

    return this.initPromise;
  }

  /** Runs whichever detectors are enabled against the current video frame. */
  update(video: HTMLVideoElement, timestampMs: number): VisionFrame {
    if (this.status === "ready") {
      if (this.faceEnabled && this.faceLandmarker && video.readyState >= 2) {
        try {
          this.lastFace = this.faceLandmarker.detectForVideo(video, timestampMs);
        } catch {
          /* transient decode hiccups are expected; keep last good result */
        }
      }
      if (this.handsEnabled && this.handLandmarker && video.readyState >= 2) {
        try {
          this.lastHands = this.handLandmarker.detectForVideo(video, timestampMs);
        } catch {
          /* ignore */
        }
      }
    }

    return {
      faceLandmarks: this.faceEnabled ? (this.lastFace?.faceLandmarks ?? []) : [],
      handLandmarks: this.handsEnabled ? (this.lastHands?.landmarks ?? []) : [],
      handedness: this.handsEnabled
        ? (this.lastHands?.handedness ?? []).map((h) => h[0]?.categoryName ?? "?")
        : [],
    };
  }

  dispose(): void {
    this.faceLandmarker?.close();
    this.handLandmarker?.close();
  }
}
