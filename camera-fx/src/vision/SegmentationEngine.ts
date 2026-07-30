import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const SEGMENTER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

export type SegmentationStatus = "idle" | "loading" | "ready" | "unavailable";

export interface SegmentationMask {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Wraps MediaPipe's single-class "selfie segmenter" model: per-pixel
 * person-vs-background confidence, entirely on-device. Same fail-soft
 * contract as VisionEngine — if the model can't be fetched, background
 * effects just stay unavailable instead of breaking anything.
 */
export class SegmentationEngine {
  private segmenter: ImageSegmenter | null = null;
  private initPromise: Promise<void> | null = null;
  private lastMask: SegmentationMask | null = null;

  status: SegmentationStatus = "idle";
  enabled = false;

  async ensureInit(): Promise<void> {
    if (this.status === "ready" || this.status === "unavailable") return;
    if (this.initPromise) return this.initPromise;

    this.status = "loading";
    this.initPromise = (async () => {
      const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE);
      this.segmenter = await ImageSegmenter.createFromOptions(filesetResolver, {
        baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      this.status = "ready";
    })().catch((err) => {
      console.warn("[SegmentationEngine] model unavailable, background effects disabled:", err);
      this.status = "unavailable";
    });

    return this.initPromise;
  }

  /** Returns the latest person-confidence mask (0 = background, 255 = person), or null if not ready/enabled. */
  update(video: HTMLVideoElement, timestampMs: number): SegmentationMask | null {
    if (this.status !== "ready" || !this.enabled || !this.segmenter || video.readyState < 2) {
      return this.lastMask;
    }
    try {
      const result = this.segmenter.segmentForVideo(video, timestampMs);
      const mask = result.confidenceMasks?.[0];
      if (mask) {
        this.lastMask = { data: mask.getAsUint8Array(), width: mask.width, height: mask.height };
        mask.close();
      }
      result.confidenceMasks?.forEach((m) => {
        if (m !== mask) m.close();
      });
      result.categoryMask?.close();
    } catch {
      /* transient decode hiccups are expected; keep last good mask */
    }
    return this.lastMask;
  }

  dispose(): void {
    this.segmenter?.close();
  }
}
