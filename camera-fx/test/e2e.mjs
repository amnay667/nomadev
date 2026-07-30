// End-to-end smoke test: drives the built app in real Chromium against a
// synthetic fake camera device (see generate-fake-camera.mjs) and asserts
// every shader effect actually renders a non-uniform frame, vision toggles
// don't crash the app even when the MediaPipe CDN is unreachable, and the
// snapshot action doesn't throw.
//
// Usage:
//   node test/generate-fake-camera.mjs test/fixtures/fake-cam.y4m
//   node test/e2e.mjs test/fixtures/fake-cam.y4m
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";

const FAKE_VIDEO = process.argv[2] ?? "test/fixtures/fake-cam.y4m";
const PORT = process.env.E2E_PORT ?? "4173";
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH; // optional override

const EFFECT_IDS = ["raw", "edge", "thermal", "ascii", "glitch", "kaleidoscope", "nightvision"];

function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - start > timeoutMs) reject(new Error("preview server did not start in time"));
          else setTimeout(attempt, 300);
        });
    };
    attempt();
  });
}

async function sampleCanvasStats(page) {
  return page.evaluate(() => {
    const c = document.getElementById("gl-canvas");
    const tmp = document.createElement("canvas");
    tmp.width = c.width;
    tmp.height = c.height;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0);
    const data = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
    let sum = 0,
      sumSq = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += lum;
      sumSq += lum * lum;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return { mean, stddev: Math.sqrt(Math.max(0, variance)) };
  });
}

async function main() {
  const server = spawn("npx", ["vite", "preview", "--port", PORT, "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  try {
    const url = `http://localhost:${PORT}`;
    await waitForServer(url);

    const browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-video-capture=${path.resolve(FAKE_VIDEO)}`,
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const unexpectedErrors = [];
    const isExpectedNetworkNoise = (text) =>
      /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(text);
    page.on("console", (msg) => {
      if (msg.type() === "error" && !isExpectedNetworkNoise(msg.text())) {
        unexpectedErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => unexpectedErrors.push(`pageerror: ${err.message}`));

    await page.goto(url, { waitUntil: "load" });
    await page.click("#btn-start");
    await page.waitForFunction(() => document.getElementById("status")?.classList.contains("hidden"), {
      timeout: 15000,
    });
    console.log("camera started");
    await page.waitForTimeout(500);

    const results = {};
    const effectButtons = await page.$$("#effect-group button");
    for (let i = 0; i < EFFECT_IDS.length; i++) {
      await effectButtons[i].click();
      await page.waitForTimeout(450);
      results[EFFECT_IDS[i]] = await sampleCanvasStats(page);
    }

    const toggleButtons = await page.$$("#vision-group button");
    for (const btn of toggleButtons) {
      if (await btn.isDisabled()) continue;
      await btn.click();
    }
    await page.waitForTimeout(1500);

    await page.click("#btn-snapshot"); // must not throw
    await page.waitForTimeout(200);

    await browser.close();

    let ok = true;
    console.log("\n=== effect render check ===");
    for (const [id, stats] of Object.entries(results)) {
      const pass = stats.stddev >= 1.0;
      console.log(`${pass ? "OK  " : "FAIL"} ${id.padEnd(14)} mean=${stats.mean.toFixed(1)} stddev=${stats.stddev.toFixed(1)}`);
      if (!pass) ok = false;
    }
    if (unexpectedErrors.length > 0) {
      ok = false;
      console.log("\nUnexpected console/page errors:");
      unexpectedErrors.forEach((e) => console.log(" -", e));
    }
    console.log(ok ? "\nPASS" : "\nFAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
