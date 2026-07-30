import { FaceLandmarker, GestureRecognizer, DrawingUtils } from "@mediapipe/tasks-vision";
import type { Landmark, VisionFrame } from "../vision/VisionEngine";
import { ParticleSystem } from "./ParticleSystem";

// Tip landmark indices in the 21-point hand topology.
const FINGERTIPS = [4, 8, 12, 16, 20];
// Glabella (between the eyebrows) in the 468-point face mesh — our "third eye" anchor.
const THIRD_EYE_LANDMARK = 9;

function mirror(landmarks: Landmark[]): Landmark[] {
  return landmarks.map((l) => ({ x: 1 - l.x, y: l.y, z: l.z, visibility: l.visibility }));
}

export class VisionOverlay {
  private readonly particles = new ParticleSystem(900);
  private drawingUtils: DrawingUtils | null = null;
  private lastFingertipSpawn = 0;

  render(
    ctx: CanvasRenderingContext2D,
    frame: VisionFrame,
    width: number,
    height: number,
    time: number,
    dt: number,
  ): void {
    if (!this.drawingUtils) this.drawingUtils = new DrawingUtils(ctx);

    if (frame.faceLandmarks.length > 0) {
      this.drawFace(ctx, mirror(frame.faceLandmarks[0]), width, height, time);
    }

    if (frame.handLandmarks.length > 0) {
      for (const raw of frame.handLandmarks) {
        this.drawHandSkeleton(mirror(raw));
        this.spawnFingertipParticles(mirror(raw), width, height, time);
      }
    }

    this.particles.update(dt);
    this.particles.draw(ctx);
  }

  private drawFace(
    ctx: CanvasRenderingContext2D,
    landmarks: Landmark[],
    width: number,
    height: number,
    time: number,
  ): void {
    const du = this.drawingUtils!;
    du.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
      color: "#5eead440",
      lineWidth: 1,
    });
    du.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
      color: "#5eead4b0",
      lineWidth: 2,
    });
    du.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, { color: "#f472b6" });
    du.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, { color: "#f472b6" });

    const eye = landmarks[THIRD_EYE_LANDMARK];
    if (!eye) return;
    const cx = eye.x * width;
    const cy = eye.y * height;
    const pulse = 0.6 + 0.4 * Math.sin(time * 3);
    const r = 10 + pulse * 4;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2);
    glow.addColorStop(0, `rgba(180, 255, 240, ${0.55 * pulse})`);
    glow.addColorStop(1, "rgba(180, 255, 240, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#eafffb";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#04211c";
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
    ctx.fill();

    const irisAngle = time * 1.3;
    ctx.fillStyle = "#5eead4";
    ctx.beginPath();
    ctx.arc(cx + Math.cos(irisAngle) * r * 0.15, cy + Math.sin(irisAngle) * r * 0.08, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawHandSkeleton(landmarks: Landmark[]): void {
    const du = this.drawingUtils!;
    du.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, {
      color: "#f472b690",
      lineWidth: 2,
    });
    du.drawLandmarks(landmarks, { color: "#f472b6", radius: 2, lineWidth: 1 });
  }

  private spawnFingertipParticles(
    landmarks: Landmark[],
    width: number,
    height: number,
    time: number,
  ): void {
    // Cheap throttle: MediaPipe can run ~30fps but we don't need to spawn
    // every single call if the render loop ever ticks faster.
    if (time - this.lastFingertipSpawn < 0.016) return;
    this.lastFingertipSpawn = time;

    FINGERTIPS.forEach((idx, i) => {
      const lm = landmarks[idx];
      if (!lm) return;
      const hue = (time * 60 + i * 60) % 360;
      this.particles.spawn(lm.x * width, lm.y * height, hue, 2);
    });
  }
}
