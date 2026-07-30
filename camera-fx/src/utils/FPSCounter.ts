export class FPSCounter {
  private frames = 0;
  private lastSample = performance.now();
  private current = 0;

  tick(): void {
    this.frames++;
    const now = performance.now();
    const elapsed = now - this.lastSample;
    if (elapsed >= 500) {
      this.current = Math.round((this.frames * 1000) / elapsed);
      this.frames = 0;
      this.lastSample = now;
    }
  }

  get fps(): number {
    return this.current;
  }
}
