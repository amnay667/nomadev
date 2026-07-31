import {
  FilesetResolver,
  FaceLandmarker,
  GestureRecognizer,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type GestureRecognizerResult,
  type PoseLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

// Everything here runs as WASM/GPU inference inside the tab. The model
// weights and WASM runtime are static files fetched once from a CDN (same
// origin policy as any <script src> import) and then executed locally —
// no video frame or landmark ever leaves the browser.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const GESTURE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export type Landmark = NormalizedLandmark;

export interface VisionFrame {
  faceLandmarks: Landmark[][];
  handLandmarks: Landmark[][];
  handedness: string[];
  /** Top canned gesture per detected hand: "None" | "Closed_Fist" | "Open_Palm" | "Pointing_Up" | "Thumb_Down" | "Thumb_Up" | "Victory" | "ILoveYou" */
  gestures: string[];
  /** 33-point BlazePose landmarks per detected body. */
  poseLandmarks: Landmark[][];
}

export type VisionStatus = "idle" | "loading" | "ready" | "unavailable";

/**
 * Lazily-initialized wrapper around MediaPipe FaceLandmarker,
 * GestureRecognizer, and PoseLandmarker. GestureRecognizer gives us hand
 * landmarks *and* canned gesture classification (Open_Palm, Victory,
 * Thumb_Up, ...) from a single model, which doubles as both the hand-trail
 * overlay input and the hands-free control signal for GestureController.
 * PoseLandmarker's 33-point body skeleton drives Posture Coach. Fails
 * soft: if the models can't be fetched (offline, blocked network, no
 * WebGL2 for the delegate, ...) the app keeps working with the live feed
 * alone and vision toggles simply report "unavailable".
 */
export class VisionEngine {
  private faceLandmarker: FaceLandmarker | null = null;
  private gestureRecognizer: GestureRecognizer | null = null;
  private poseLandmarker: PoseLandmarker | null = null;
  private lastFace: FaceLandmarkerResult | null = null;
  private lastGesture: GestureRecognizerResult | null = null;
  private lastPose: PoseLandmarkerResult | null = null;
  private initPromise: Promise<void> | null = null;

  status: VisionStatus = "idle";
  faceEnabled = false;
  handsEnabled = false;
  poseEnabled = false;

  async ensureInit(): Promise<void> {
    if (this.status === "ready" || this.status === "unavailable") return;
    if (this.initPromise) return this.initPromise;

    this.status = "loading";
    this.initPromise = (async () => {
      const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE);

      [this.faceLandmarker, this.gestureRecognizer, this.poseLandmarker] = await Promise.all([
        FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        }),
        GestureRecognizer.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: GESTURE_MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
        }),
        PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
          outputSegmentationMasks: false,
        }),
      ]);

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
      if (this.handsEnabled && this.gestureRecognizer && video.readyState >= 2) {
        try {
          this.lastGesture = this.gestureRecognizer.recognizeForVideo(video, timestampMs);
        } catch {
          /* ignore */
        }
      }
      if (this.poseEnabled && this.poseLandmarker && video.readyState >= 2) {
        try {
          this.lastPose = this.poseLandmarker.detectForVideo(video, timestampMs);
        } catch {
          /* ignore */
        }
      }
    }

    return {
      faceLandmarks: this.faceEnabled ? (this.lastFace?.faceLandmarks ?? []) : [],
      handLandmarks: this.handsEnabled ? (this.lastGesture?.landmarks ?? []) : [],
      handedness: this.handsEnabled
        ? (this.lastGesture?.handedness ?? []).map((h) => h[0]?.categoryName ?? "?")
        : [],
      gestures: this.handsEnabled
        ? (this.lastGesture?.gestures ?? []).map((g) => g[0]?.categoryName ?? "None")
        : [],
      poseLandmarks: this.poseEnabled ? (this.lastPose?.landmarks ?? []) : [],
    };
  }

  dispose(): void {
    this.faceLandmarker?.close();
    this.gestureRecognizer?.close();
    this.poseLandmarker?.close();
  }
}
