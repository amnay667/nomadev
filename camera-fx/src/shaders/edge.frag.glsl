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

void main() {
  vec2 texel = 1.0 / uResolution;

  // 3x3 Sobel operator over luminance.
  float tl = luma(texture(uTexture, vUv + texel * vec2(-1.0,  1.0)).rgb);
  float  t = luma(texture(uTexture, vUv + texel * vec2( 0.0,  1.0)).rgb);
  float tr = luma(texture(uTexture, vUv + texel * vec2( 1.0,  1.0)).rgb);
  float  l = luma(texture(uTexture, vUv + texel * vec2(-1.0,  0.0)).rgb);
  float  r = luma(texture(uTexture, vUv + texel * vec2( 1.0,  0.0)).rgb);
  float bl = luma(texture(uTexture, vUv + texel * vec2(-1.0, -1.0)).rgb);
  float  b = luma(texture(uTexture, vUv + texel * vec2( 0.0, -1.0)).rgb);
  float br = luma(texture(uTexture, vUv + texel * vec2( 1.0, -1.0)).rgb);

  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float edge = clamp(sqrt(gx * gx + gy * gy), 0.0, 1.0);

  // Cyan/magenta scanner palette, pulsing faintly with time.
  float pulse = 0.85 + 0.15 * sin(uTime * 1.5);
  vec3 col = mix(vec3(0.01, 0.02, 0.05), vec3(0.15, 1.0, 0.95) * pulse, edge);
  col += vec3(0.9, 0.15, 0.6) * pow(edge, 4.0) * 0.5;

  outColor = vec4(col, 1.0);
}
