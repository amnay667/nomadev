import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import { FEATURE_NAMES, type Features } from "./features.js";

/**
 * A tiny online logistic-regression scorer. Every closed trade is one
 * training example (features at entry -> profitable or not), so the entry
 * criteria drift toward whatever has actually worked in this bot's own
 * trade history instead of staying fixed. This is a real, if simple, form
 * of learning-from-outcomes — not a claim of predictive trading skill.
 */
interface ModelState {
  weights: Features;
  bias: number;
  samples: number;
}

function zeroWeights(): Features {
  return Object.fromEntries(FEATURE_NAMES.map((f) => [f, 0])) as Features;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export class ScoringModel {
  private state: ModelState;

  constructor() {
    this.state = this.load();
  }

  private load(): ModelState {
    if (existsSync(config.modelFile)) {
      return JSON.parse(readFileSync(config.modelFile, "utf-8"));
    }
    return { weights: zeroWeights(), bias: 0, samples: 0 };
  }

  private persist() {
    mkdirSync(dirname(config.modelFile), { recursive: true });
    writeFileSync(config.modelFile, JSON.stringify(this.state, null, 2));
  }

  /** Probability (0-1) that this setup is worth entering. */
  score(features: Features): number {
    const z =
      this.state.bias +
      FEATURE_NAMES.reduce(
        (sum, f) => sum + this.state.weights[f] * features[f],
        0,
      );
    return sigmoid(z);
  }

  /** Update weights from a closed trade's outcome (1 = profitable, 0 = not). */
  learn(features: Features, outcome: 0 | 1) {
    const predicted = this.score(features);
    const error = outcome - predicted;

    for (const f of FEATURE_NAMES) {
      this.state.weights[f] += config.learningRate * error * features[f];
    }
    this.state.bias += config.learningRate * error;
    this.state.samples += 1;

    this.persist();
  }

  get sampleCount(): number {
    return this.state.samples;
  }
}
