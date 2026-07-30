function pickMimeType(): string {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "video/webm";
}

/**
 * Records a canvas via captureStream()+MediaRecorder and hands back a
 * downloadable Blob. The caller is responsible for continuously drawing
 * onto that canvas while recording is active (see main.ts's merged
 * gl+overlay compositing canvas) -- this class only owns the encoder.
 */
export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopPromise: Promise<Blob> | null = null;

  get isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === "recording";
  }

  start(canvas: HTMLCanvasElement, fps = 30): void {
    if (this.isRecording) return;
    const stream = canvas.captureStream(fps);
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.stopPromise = new Promise<Blob>((resolve) => {
      this.recorder!.onstop = () => resolve(new Blob(this.chunks, { type: mimeType }));
    });
    this.recorder.start();
  }

  async stop(): Promise<Blob | null> {
    if (!this.recorder || this.recorder.state === "inactive") return null;
    const pending = this.stopPromise;
    this.recorder.stop();
    this.recorder.stream.getTracks().forEach((t) => t.stop());
    this.recorder = null;
    return pending ?? null;
  }
}
