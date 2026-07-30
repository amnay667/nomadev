#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;

const float CELL_PX = 10.0;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// Procedural "glyph" shapes standing in for . : + * # @ █ at increasing
// brightness levels, built entirely from distance fields (no font texture).
float glyphMask(int level, vec2 p) {
  float box = max(abs(p.x), abs(p.y));
  float dot0 = length(p);

  if (level <= 0) return 0.0;
  if (level == 1) return step(dot0, 0.07);
  if (level == 2) return step(dot0, 0.15);

  float linev = step(abs(p.x), 0.07) * step(abs(p.y), 0.36);
  float lineh = step(abs(p.y), 0.07) * step(abs(p.x), 0.36);
  float plus = max(linev, lineh);
  if (level == 3) return plus;

  vec2 pr = vec2(p.x + p.y, p.x - p.y) * 0.7071;
  float dv = step(abs(pr.x), 0.07) * step(abs(pr.y), 0.36);
  float dh = step(abs(pr.y), 0.07) * step(abs(pr.x), 0.36);
  float xshape = max(dv, dh);
  if (level == 4) return max(plus, xshape * 0.9);

  if (level == 5) return max(max(plus, xshape), step(box, 0.42) * 0.5);
  if (level == 6) return step(box, 0.44);
  return 1.0; // level 7: solid block
}

void main() {
  vec2 cellsPerScreen = uResolution / CELL_PX;
  vec2 cellCoord = floor(vUv * cellsPerScreen);
  vec2 cellUv = (cellCoord + 0.5) / cellsPerScreen;

  vec3 cellColor = texture(uTexture, cellUv).rgb;
  float l = luma(cellColor);

  int level = int(clamp(floor(l * 8.0), 0.0, 7.0));

  vec2 p = fract(vUv * cellsPerScreen) - 0.5;
  float mask = glyphMask(level, p);

  // Boost saturation a touch so the glyphs read as colour, not grey mush.
  vec3 tint = mix(vec3(l), cellColor, 0.85);
  tint = clamp(tint * 1.25, 0.0, 1.0);

  vec3 bg = vec3(0.02, 0.02, 0.03);
  outColor = vec4(mix(bg, tint, mask), 1.0);
}
