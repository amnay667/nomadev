#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// Black -> blue -> purple -> red -> orange -> yellow -> white, like a FLIR palette.
vec3 thermalPalette(float t) {
  vec3 c0 = vec3(0.0, 0.0, 0.02);
  vec3 c1 = vec3(0.12, 0.0, 0.35);
  vec3 c2 = vec3(0.55, 0.0, 0.45);
  vec3 c3 = vec3(0.9, 0.15, 0.0);
  vec3 c4 = vec3(1.0, 0.55, 0.0);
  vec3 c5 = vec3(1.0, 0.95, 0.4);
  vec3 c6 = vec3(1.0, 1.0, 1.0);

  float s = t * 6.0;
  if (s < 1.0) return mix(c0, c1, s);
  if (s < 2.0) return mix(c1, c2, s - 1.0);
  if (s < 3.0) return mix(c2, c3, s - 2.0);
  if (s < 4.0) return mix(c3, c4, s - 3.0);
  if (s < 5.0) return mix(c4, c5, s - 4.0);
  return mix(c5, c6, s - 5.0);
}

void main() {
  vec2 texel = 1.0 / uResolution;
  // Slight blur to emulate thermal-sensor softness.
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      float w = 1.0 / (1.0 + float(x * x + y * y));
      sum += texture(uTexture, vUv + texel * vec2(float(x), float(y))).rgb * w;
      wsum += w;
    }
  }
  float l = luma(sum / wsum);

  // Slow-drifting noise so flat regions still "breathe" like real sensor noise.
  float grain = fract(sin(dot(vUv * uResolution + uTime * 13.0, vec2(12.9898, 78.233))) * 43758.5453);
  l = clamp(l + (grain - 0.5) * 0.03, 0.0, 1.0);

  vec3 col = thermalPalette(l);

  // Vignette to sell the "sensor" look.
  vec2 d = vUv - 0.5;
  float vig = 1.0 - dot(d, d) * 0.6;
  col *= vig;

  outColor = vec4(col, 1.0);
}
