export class FrameProfiler {
  constructor() {
    this.samples = new Map();
    this.frameCount = 0;
    this.lastFpsTime = 0;
    this.lastFpsFrame = 0;
    this.fps = 60;
  }

  measure(name, fn) {
    const started = performance.now();
    const result = fn();
    this.record(name, performance.now() - started);
    return result;
  }

  record(name, milliseconds) {
    const value = Number(milliseconds) || 0;
    const previous = this.samples.get(name);
    this.samples.set(name, previous == null ? value : previous + (value - previous) * 0.12);
  }

  frame(now = performance.now()) {
    this.frameCount += 1;
    if (!this.lastFpsTime) {
      this.lastFpsTime = now;
      this.lastFpsFrame = this.frameCount;
      return;
    }
    const elapsed = now - this.lastFpsTime;
    if (elapsed >= 500) {
      const frames = this.frameCount - this.lastFpsFrame;
      this.fps = frames * 1000 / elapsed;
      this.lastFpsTime = now;
      this.lastFpsFrame = this.frameCount;
    }
  }

  snapshot(extra = {}) {
    return Object.freeze({
      fps: this.fps,
      ...Object.fromEntries([...this.samples.entries()].map(([key, value]) => [key, value])),
      ...extra
    });
  }
}
