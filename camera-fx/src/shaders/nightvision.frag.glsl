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

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 texel = 1.0 / uResolution;

  // Cheap 5-tap bloom: bright areas leak into their neighbourhood.
  vec3 center = texture(uTexture, vUv).rgb;
  vec3 bloom = vec3(0.0);
  vec2 offsets[4] = vec2[4](vec2(2.0, 0.0), vec2(-2.0, 0.0), vec2(0.0, 2.0), vec2(0.0, -2.0));
  for (int i = 0; i < 4; i++) {
    vec3 s = texture(uTexture, vUv + texel * offsets[i] * 3.0).rgb;
    float b = max(luma(s) - 0.55, 0.0);
    bloom += s * b;
  }
  vec3 amplified = center * 2.6 + bloom * 0.8;

  float l = luma(amplified);
  vec3 green = vec3(0.05, 1.0, 0.15) * l;

  // Grain + rolling scanline sweep, classic image-intensifier tube look.
  float grain = rand(vUv * uResolution + fract(uTime) * 100.0) - 0.5;
  green += grain * 0.06;

  float scan = 0.9 + 0.1 * sin((vUv.y * uResolution.y - uTime * 60.0) * 0.9);
  green *= scan;

  // Circular vignette mimicking a scope eyepiece.
  vec2 d = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float r = length(d);
  float vignette = smoothstep(0.75, 0.35, r);
  green *= vignette;
  green += (1.0 - vignette) * vec3(0.0);

  outColor = vec4(clamp(green, 0.0, 1.0), 1.0);
}
