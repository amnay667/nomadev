#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;
uniform vec2 uResolution;

void main() {
  outColor = vec4(texture(uTexture, vUv).rgb, 1.0);
}
