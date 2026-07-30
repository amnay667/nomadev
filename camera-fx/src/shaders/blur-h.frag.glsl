#version 300 es
precision highp float;

// First blur pass: reads the raw camera texture directly, so it uses the
// mirrored vUv (same convention as every other first-hop effect shader).
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uRadius;

void main() {
  vec2 texel = vec2(1.0, 0.0) / uResolution;
  vec2 off1 = texel * 1.3846153846 * uRadius;
  vec2 off2 = texel * 3.2307692308 * uRadius;

  vec3 sum = texture(uTexture, vUv).rgb * 0.2270270270;
  sum += texture(uTexture, vUv + off1).rgb * 0.3162162162;
  sum += texture(uTexture, vUv - off1).rgb * 0.3162162162;
  sum += texture(uTexture, vUv + off2).rgb * 0.0702702703;
  sum += texture(uTexture, vUv - off2).rgb * 0.0702702703;

  outColor = vec4(sum, 1.0);
}
