import type { EffectDef } from "../core/GLRenderer";

import passthroughSrc from "../shaders/passthrough.frag.glsl?raw";
import edgeSrc from "../shaders/edge.frag.glsl?raw";
import thermalSrc from "../shaders/thermal.frag.glsl?raw";
import asciiSrc from "../shaders/ascii.frag.glsl?raw";
import glitchSrc from "../shaders/glitch.frag.glsl?raw";
import kaleidoscopeSrc from "../shaders/kaleidoscope.frag.glsl?raw";
import nightvisionSrc from "../shaders/nightvision.frag.glsl?raw";

export const EFFECTS: EffectDef[] = [
  { id: "raw", label: "Raw", fragmentSource: passthroughSrc },
  { id: "edge", label: "Edge Scan", fragmentSource: edgeSrc },
  { id: "thermal", label: "Thermal", fragmentSource: thermalSrc },
  { id: "ascii", label: "ASCII", fragmentSource: asciiSrc },
  { id: "glitch", label: "Datamosh", fragmentSource: glitchSrc },
  { id: "kaleidoscope", label: "Kaleidoscope", fragmentSource: kaleidoscopeSrc },
  { id: "nightvision", label: "Night Vision", fragmentSource: nightvisionSrc },
];

export function findEffect(id: string): EffectDef {
  return EFFECTS.find((e) => e.id === id) ?? EFFECTS[0];
}
