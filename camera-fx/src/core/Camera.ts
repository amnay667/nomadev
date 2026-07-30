export interface CameraOptions {
  video: HTMLVideoElement;
  idealWidth?: number;
  idealHeight?: number;
  facingMode?: "user" | "environment";
}

export class CameraError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
  ) {
    super(message);
    this.name = "CameraError";
  }
}

/**
 * Thin wrapper around getUserMedia. Nothing captured here ever leaves the
 * page: the MediaStream is only ever piped into a local <video> element,
 * which the render pipeline reads back from via texImage2D.
 */
export class Camera {
  private stream: MediaStream | null = null;
  private readonly video: HTMLVideoElement;
  private readonly opts: Required<Omit<CameraOptions, "video">>;

  constructor(opts: CameraOptions) {
    this.video = opts.video;
    this.opts = {
      idealWidth: opts.idealWidth ?? 1280,
      idealHeight: opts.idealHeight ?? 720,
      facingMode: opts.facingMode ?? "user",
    };
  }

  get width(): number {
    return this.video.videoWidth;
  }

  get height(): number {
    return this.video.videoHeight;
  }

  get element(): HTMLVideoElement {
    return this.video;
  }

  get isRunning(): boolean {
    return this.stream !== null;
  }

  async start(): Promise<{ width: number; height: number }> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError(
        "This browser doesn't support camera access (getUserMedia unavailable).",
        null,
      );
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: this.opts.idealWidth },
          height: { ideal: this.opts.idealHeight },
          facingMode: this.opts.facingMode,
          frameRate: { ideal: 30, max: 60 },
        },
      });
    } catch (err) {
      throw new CameraError(this.describeError(err), err);
    }

    this.video.srcObject = this.stream;

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = (e: Event) => {
        cleanup();
        reject(new CameraError("Video element failed to load the camera stream.", e));
      };
      const cleanup = () => {
        this.video.removeEventListener("loadedmetadata", onLoaded);
        this.video.removeEventListener("error", onError);
      };
      this.video.addEventListener("loadedmetadata", onLoaded, { once: true });
      this.video.addEventListener("error", onError, { once: true });
    });

    await this.video.play();

    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private describeError(err: unknown): string {
    const name = (err as { name?: string })?.name;
    switch (name) {
      case "NotAllowedError":
        return "Camera access was denied. Allow camera permission and try again.";
      case "NotFoundError":
        return "No camera device was found on this system.";
      case "NotReadableError":
        return "The camera is already in use by another application.";
      case "OverconstrainedError":
        return "No camera satisfies the requested resolution/facing mode.";
      default:
        return `Could not access the camera (${name ?? "unknown error"}).`;
    }
  }
}
