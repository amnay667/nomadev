#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;
uniform sampler2D uPrevFrame;
uniform vec2 uResolution;
uniform float uTime;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  const float blockH = 22.0;
  float rowId = floor(vUv.y * uResolution.y / blockH);

  // Per-row horizontal tear, re-rolled a few times a second.
  float tearSeed = rand(vec2(rowId, floor(uTime * 9.0)));
  float tearActive = step(0.86, rand(vec2(rowId * 3.1, floor(uTime * 5.0) + 1.0)));
  float shift = (tearSeed - 0.5) * 0.12 * tearActive;

  vec2 uv = vUv + vec2(shift, 0.0);
  uv = clamp(uv, 0.0, 1.0);

  // Chromatic aberration, breathing over time.
  float ca = 0.0035 + 0.0025 * sin(uTime * 2.3);
  float rCh = texture(uTexture, uv + vec2(ca, 0.0)).r;
  float gCh = texture(uTexture, uv).g;
  float bCh = texture(uTexture, uv - vec2(ca, 0.0)).b;
  vec3 cur = vec3(rCh, gCh, bCh);

  // Datamosh: some rows "fail to update" and keep showing the accumulated
  // previous frame instead of the fresh one, like a corrupted P-frame.
  float moshRoll = rand(vec2(rowId * 1.7, floor(uTime * 2.5)));
  float moshAmt = smoothstep(0.90, 0.99, moshRoll);
  vec3 prev = texture(uPrevFrame, vUv).rgb;
  vec3 col = mix(cur, prev, moshAmt);

  // Scanlines + faint rolling brightness bar.
  float scan = 0.94 + 0.06 * sin(vUv.y * uResolution.y * 1.5);
  float rollBar = smoothstep(0.0, 0.05, abs(fract(vUv.y - uTime * 0.08) - 0.5) - 0.45) ;
  col *= scan;
  col += vec3(0.05) * (1.0 - rollBar) * 0.3;

  // Occasional whole-frame noise burst.
  float burst = step(0.985, rand(vec2(floor(uTime * 7.0), 4.2)));
  float grain = rand(vUv * uResolution + uTime) * burst * 0.5;
  col += grain;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
