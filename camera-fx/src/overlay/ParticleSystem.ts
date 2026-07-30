interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
}

/**
 * Lightweight 2D particle emitter used for the fingertip "spark trail"
 * effect. Spawns are driven externally (once per tracked fingertip per
 * frame); this class only owns physics + rendering.
 */
export class ParticleSystem {
  private particles: Particle[] = [];
  private readonly maxParticles: number;

  constructor(maxParticles = 700) {
    this.maxParticles = maxParticles;
  }

  spawn(x: number, y: number, hue: number, count = 3): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.4 + Math.random() * 1.6;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.6,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.6,
        size: 1.5 + Math.random() * 2.5,
        hue: hue + (Math.random() - 0.5) * 40,
      });
    }
  }

  update(dtSeconds: number): void {
    const dt = Math.min(dtSeconds, 0.05);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += 0.9 * dt; // gravity
      p.vx *= 1 - 0.8 * dt; // drag
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      const alpha = 1 - t;
      const size = p.size * (1 - t * 0.6);
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 4);
      grad.addColorStop(0, `hsla(${p.hue}, 100%, 70%, ${alpha})`);
      grad.addColorStop(1, `hsla(${p.hue}, 100%, 60%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  get count(): number {
    return this.particles.length;
  }
}
