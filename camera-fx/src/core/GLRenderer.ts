const VERTEX_SHADER = `#version 300 es
out vec2 vUv;
void main() {
  vec2 uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  // Mirror horizontally so the feed reads like a selfie mirror; landmark
  // math in the overlay layer mirrors the same way to stay in registration.
  vUv = vec2(1.0 - uv.x, uv.y);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

export type UniformValue = number | [number, number] | [number, number, number] | [number, number, number, number];

export interface EffectDef {
  id: string;
  label: string;
  /** GLSL ES 3.00 fragment shader body (no #version/precision/in/out boilerplate needed if using `fragmentSource`). */
  fragmentSource: string;
  /** Optional per-frame extra uniforms (beyond the built-ins every shader gets). */
  uniforms?: Record<string, UniformValue>;
}

interface CompiledProgram {
  program: WebGLProgram;
  uniformLocations: Map<string, WebGLUniformLocation | null>;
}

/**
 * WebGL2 single-pass-per-frame renderer with a rolling "previous frame"
 * feedback texture, so any effect can do trails/datamoshing/motion-blur
 * style compositing just by sampling `uPrevFrame`.
 */
export class GLRenderer {
  readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly programs = new Map<string, CompiledProgram>();
  private readonly videoTexture: WebGLTexture;
  private prevFrameTexture: WebGLTexture;
  private prevFrameSize = { width: 0, height: 0 };
  private startTime = performance.now();
  private vao: WebGLVertexArrayObject;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true, // needed so we can read pixels back for snapshots
    });
    if (!gl) {
      throw new Error("WebGL2 is not supported in this browser.");
    }
    this.gl = gl;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    this.videoTexture = this.createTexture();
    this.prevFrameTexture = this.createTexture();
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
    // Reset the feedback texture to the new size (avoids stretched garbage).
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.prevFrameSize = { width: w, height: h };
  }

  private compile(id: string, fragmentBody: string): CompiledProgram {
    const cached = this.programs.get(id);
    if (cached) return cached;

    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fragmentBody);

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`[${id}] Program link failed: ${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const compiled: CompiledProgram = { program, uniformLocations: new Map() };
    this.programs.set(id, compiled);
    return compiled;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      const info = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
      gl.deleteShader(shader);
      throw new Error(`${info} shader compile failed: ${log}`);
    }
    return shader;
  }

  private location(compiled: CompiledProgram, name: string): WebGLUniformLocation | null {
    if (!compiled.uniformLocations.has(name)) {
      compiled.uniformLocations.set(name, this.gl.getUniformLocation(compiled.program, name));
    }
    return compiled.uniformLocations.get(name) ?? null;
  }

  private setUniform(compiled: CompiledProgram, name: string, value: UniformValue): void {
    const gl = this.gl;
    const loc = this.location(compiled, name);
    if (!loc) return;
    if (typeof value === "number") gl.uniform1f(loc, value);
    else if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
    else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
    else gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
  }

  /** Uploads the current video frame as the source texture. */
  uploadVideoFrame(source: TexImageSource): void {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  renderEffect(effect: EffectDef, extraUniforms?: Record<string, UniformValue>): void {
    const gl = this.gl;
    const compiled = this.compile(effect.id, effect.fragmentSource);
    gl.useProgram(compiled.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    this.setUniform(compiled, "uTexture", 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
    this.setUniform(compiled, "uPrevFrame", 1);

    this.setUniform(compiled, "uResolution", [this.canvas.width, this.canvas.height]);
    this.setUniform(compiled, "uTime", (performance.now() - this.startTime) / 1000);

    for (const [key, value] of Object.entries(effect.uniforms ?? {})) {
      this.setUniform(compiled, key, value);
    }
    if (extraUniforms) {
      for (const [key, value] of Object.entries(extraUniforms)) {
        this.setUniform(compiled, key, value);
      }
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.captureFeedback();
  }

  private captureFeedback(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, this.canvas.width, this.canvas.height, 0);
  }

  readPixelsAsDataURL(): string {
    return this.canvas.toDataURL("image/png");
  }
}
