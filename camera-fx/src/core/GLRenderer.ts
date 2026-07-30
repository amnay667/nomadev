import blurHSrc from "../shaders/blur-h.frag.glsl?raw";
import blurVSrc from "../shaders/blur-v.frag.glsl?raw";
import compositeSrc from "../shaders/composite.frag.glsl?raw";

// vUv: mirrored (1-x) camera-space uv -- use this to sample uTexture (raw
// video) or any fresh, un-mirrored source (like the segmentation mask),
// so the mirror gets applied at first use.
// vScreenUv: raw, unflipped screen-fraction uv -- use this to sample any
// texture that is itself the output of an earlier pass in *this* pipeline
// (an effect render-target, a blur pass, uPrevFrame), since that content
// was already written out in screen-space addressing. Mixing these up
// causes a second, unwanted horizontal flip.
const VERTEX_SHADER = `#version 300 es
out vec2 vUv;
out vec2 vScreenUv;
void main() {
  vec2 uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vScreenUv = uv;
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

export type BackgroundMode = "off" | "blur" | "color" | "image";

interface CompiledProgram {
  program: WebGLProgram;
  uniformLocations: Map<string, WebGLUniformLocation | null>;
}

interface RenderTarget {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
}

interface RenderOptions {
  target?: RenderTarget | null;
  sourceTexture?: WebGLTexture;
  extraUniforms?: Record<string, UniformValue>;
}

/**
 * WebGL2 renderer with a rolling "previous frame" feedback texture (so any
 * effect can do trails/datamoshing/motion-blur just by sampling
 * `uPrevFrame`) plus an optional second stage: render the selected effect
 * to an offscreen target, derive a background layer (blurred video / solid
 * colour / replacement image), and composite the two using a live
 * person-segmentation mask. That second stage only runs when a background
 * mode is active, so the common case (no background effect) stays a single
 * draw call straight to the canvas.
 */
export class GLRenderer {
  readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly programs = new Map<string, CompiledProgram>();
  private readonly videoTexture: WebGLTexture;
  private prevFrameTexture: WebGLTexture;
  private startTime = performance.now();
  private vao: WebGLVertexArrayObject;

  private effectTarget: RenderTarget | null = null;
  private blurTargetA: RenderTarget | null = null;
  private blurTargetB: RenderTarget | null = null;
  private targetSize = { width: 0, height: 0 };

  private maskTexture: WebGLTexture;
  private bgImageTexture: WebGLTexture;
  private solidColorTexture: WebGLTexture;

  backgroundMode: BackgroundMode = "off";
  blurRadius = 2.2;
  maskFeather = 0.08;

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
    this.maskTexture = this.createTexture();
    this.bgImageTexture = this.createTexture();
    this.solidColorTexture = this.createTexture();
    this.setBackgroundColor(0.02, 0.85, 0.4);

    // Sampling a texture with no allocated storage is undefined behaviour.
    // Default the mask to "fully foreground" (255) so the effect renders
    // normally until a real segmentation mask arrives, and default the
    // replacement-background image to a neutral fill until one is uploaded.
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    gl.bindTexture(gl.TEXTURE_2D, this.bgImageTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 20, 24, 255]));
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

  private createRenderTarget(width: number, height: number): RenderTarget {
    const gl = this.gl;
    const texture = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, texture };
  }

  private resizeRenderTarget(target: RenderTarget, width: number, height: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  private ensureOffscreenTargets(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.targetSize.width === w && this.targetSize.height === h && this.effectTarget) return;

    if (!this.effectTarget) {
      this.effectTarget = this.createRenderTarget(w, h);
      this.blurTargetA = this.createRenderTarget(w, h);
      this.blurTargetB = this.createRenderTarget(w, h);
    } else {
      this.resizeRenderTarget(this.effectTarget, w, h);
      this.resizeRenderTarget(this.blurTargetA!, w, h);
      this.resizeRenderTarget(this.blurTargetB!, w, h);
    }
    this.targetSize = { width: w, height: h };
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

  /**
   * Sampler uniforms (the texture-unit index a `sampler2D` should read from)
   * must be set with `uniform1i`, never `uniform1f` -- using the float
   * setter on a sampler is a type mismatch that WebGL silently rejects
   * (INVALID_OPERATION, uniform left unchanged), which is a very easy way
   * to end up with every texture uniform quietly aliased to unit 0.
   */
  private setSamplerUniform(compiled: CompiledProgram, name: string, unit: number): void {
    const loc = this.location(compiled, name);
    if (!loc) return;
    this.gl.uniform1i(loc, unit);
  }

  /** Uploads the current video frame as the source texture. */
  uploadVideoFrame(source: TexImageSource): void {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /** Uploads a fresh person-confidence mask (0..255, single channel). */
  uploadMask(data: Uint8Array, width: number, height: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  /** Uploads a static replacement-background image (already cropped to the output aspect). */
  uploadBackgroundImage(source: TexImageSource): void {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.bgImageTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  setBackgroundColor(r: number, g: number, b: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.solidColorTexture);
    const bytes = new Uint8Array([r * 255, g * 255, b * 255, 255]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  }

  /** Debug/QA only: reads back a single mask texel + the last GL error, bypassing the composite shader entirely. */
  debugReadMask(u: number, v: number): { value: number; glError: number } {
    const gl = this.gl;
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.maskTexture, 0);
    const px = new Uint8Array(4);
    // maskTexture may be any size; readPixels needs an integer coordinate,
    // so figure out its size via TEXTURE_WIDTH/HEIGHT query is unavailable
    // on the texture directly -- instead this relies on the caller knowing
    // the mask's own resolution and passing already-scaled integer coords
    // via u,v (here reused as pixel x,y for simplicity).
    gl.readPixels(u, v, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const glError = gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    return { value: px[0], glError };
  }

  private renderEffect(effect: EffectDef, opts: RenderOptions = {}): void {
    const gl = this.gl;
    const compiled = this.compile(effect.id, effect.fragmentSource);
    gl.useProgram(compiled.program);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, opts.target?.fbo ?? null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, opts.sourceTexture ?? this.videoTexture);
    this.setSamplerUniform(compiled, "uTexture", 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
    this.setSamplerUniform(compiled, "uPrevFrame", 1);

    this.setUniform(compiled, "uResolution", [this.canvas.width, this.canvas.height]);
    this.setUniform(compiled, "uTime", (performance.now() - this.startTime) / 1000);

    for (const [key, value] of Object.entries(effect.uniforms ?? {})) {
      this.setUniform(compiled, key, value);
    }
    if (opts.extraUniforms) {
      for (const [key, value] of Object.entries(opts.extraUniforms)) {
        this.setUniform(compiled, key, value);
      }
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private renderComposite(effectTarget: RenderTarget, backgroundTexture: WebGLTexture): void {
    const gl = this.gl;
    const compiled = this.compile("internal:composite", compositeSrc);
    gl.useProgram(compiled.program);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, effectTarget.texture);
    this.setSamplerUniform(compiled, "uEffectTex", 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
    this.setSamplerUniform(compiled, "uBackgroundTex", 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    this.setSamplerUniform(compiled, "uMask", 2);

    this.setUniform(compiled, "uFeather", this.maskFeather);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private renderBlurredBackground(): WebGLTexture {
    const compiledH: EffectDef = { id: "internal:blur-h", label: "", fragmentSource: blurHSrc };
    const compiledV: EffectDef = { id: "internal:blur-v", label: "", fragmentSource: blurVSrc };
    this.renderEffect(compiledH, { target: this.blurTargetA!, extraUniforms: { uRadius: this.blurRadius } });
    this.renderEffect(compiledV, {
      target: this.blurTargetB!,
      sourceTexture: this.blurTargetA!.texture,
      extraUniforms: { uRadius: this.blurRadius },
    });
    return this.blurTargetB!.texture;
  }

  private captureFeedback(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, this.canvas.width, this.canvas.height, 0);
  }

  /** Renders the selected shader effect, applying background segmentation compositing if active. */
  render(effect: EffectDef, extraUniforms?: Record<string, UniformValue>): void {
    if (this.backgroundMode === "off") {
      this.renderEffect(effect, { extraUniforms });
      this.captureFeedback();
      return;
    }

    this.ensureOffscreenTargets();
    this.renderEffect(effect, { target: this.effectTarget!, extraUniforms });
    this.captureFeedback();

    const backgroundTexture =
      this.backgroundMode === "blur"
        ? this.renderBlurredBackground()
        : this.backgroundMode === "image"
          ? this.bgImageTexture
          : this.solidColorTexture;

    this.renderComposite(this.effectTarget!, backgroundTexture);
  }

  readPixelsAsDataURL(): string {
    return this.canvas.toDataURL("image/png");
  }
}
