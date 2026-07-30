#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vScreenUv;
out vec4 outColor;

// The selected shader effect, pre-rendered to an offscreen target -- an
// FBO output, so it's read back in screen-space (vScreenUv).
uniform sampler2D uEffectTex;
// Whatever should show through behind the person: blurred video, a solid
// colour, or a replacement image -- also screen-space (vScreenUv).
uniform sampler2D uBackgroundTex;
// Raw person-confidence mask straight from the segmentation model: fresh,
// un-mirrored camera-space data, so it uses vUv like uTexture would.
uniform sampler2D uMask;
uniform float uFeather;

void main() {
  float m = texture(uMask, vUv).r;
  float alpha = smoothstep(0.5 - uFeather, 0.5 + uFeather, m);

  vec3 fg = texture(uEffectTex, vScreenUv).rgb;
  vec3 bg = texture(uBackgroundTex, vScreenUv).rgb;
  outColor = vec4(mix(bg, fg, alpha), 1.0);
}
