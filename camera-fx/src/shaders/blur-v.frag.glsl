#version 300 es
precision highp float;

// Second blur pass: reads the horizontal pass's render-target, which is
// already in screen-space addressing (it was written out through the same
// full-screen-triangle vertex shader), so this one must use vScreenUv --
// sampling it with the mirrored vUv would flip the blurred image relative
// to the sharp foreground it gets composited against.
in vec2 vScreenUv;
out vec4 outColor;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uRadius;

void main() {
  vec2 texel = vec2(0.0, 1.0) / uResolution;
  vec2 off1 = texel * 1.3846153846 * uRadius;
  vec2 off2 = texel * 3.2307692308 * uRadius;

  vec3 sum = texture(uTexture, vScreenUv).rgb * 0.2270270270;
  sum += texture(uTexture, vScreenUv + off1).rgb * 0.3162162162;
  sum += texture(uTexture, vScreenUv - off1).rgb * 0.3162162162;
  sum += texture(uTexture, vScreenUv + off2).rgb * 0.0702702703;
  sum += texture(uTexture, vScreenUv - off2).rgb * 0.0702702703;

  outColor = vec4(sum, 1.0);
}
