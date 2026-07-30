#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;

const float PI = 3.14159265359;
const float SEGMENTS = 7.0;

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = vUv - 0.5;
  uv.x *= aspect;

  float radius = length(uv) * (0.9 + 0.08 * sin(uTime * 0.6));
  float angle = atan(uv.y, uv.x) + uTime * 0.15;

  float seg = (2.0 * PI) / SEGMENTS;
  angle = mod(angle, seg);
  angle = abs(angle - seg * 0.5);

  vec2 sampleUv = vec2(cos(angle), sin(angle)) * radius;
  sampleUv.x /= aspect;
  sampleUv += 0.5;

  // Mirror-wrap so edges tile seamlessly instead of showing hard clamps.
  sampleUv = abs(mod(sampleUv, 2.0) - 1.0);

  vec3 col = texture(uTexture, sampleUv).rgb;
  col = pow(col, vec3(0.9)) * 1.08; // slight punch

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
