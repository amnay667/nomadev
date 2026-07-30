// End-to-end smoke test: drives the built app in real Chromium against a
// synthetic fake camera device (see generate-fake-camera.mjs) and asserts
// the live feed actually renders a non-uniform frame, vision toggles don't
// crash the app even when the MediaPipe CDN is unreachable, background
// modes composite correctly, recording produces a real download, and the
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

    const feedStats = await sampleCanvasStats(page);
    console.log(`live feed render check: mean=${feedStats.mean.toFixed(1)} stddev=${feedStats.stddev.toFixed(1)}`);
    const feedOk = feedStats.stddev >= 1.0;

    const toggleButtons = await page.$$("#vision-group button");
    for (const btn of toggleButtons) {
      if (await btn.isDisabled()) continue;
      await btn.click();
    }
    await page.waitForTimeout(1500);

    await page.click("#btn-snapshot"); // must not throw
    await page.waitForTimeout(200);

    // Background modes must not crash even without a reachable segmentation
    // model (they should just have no visible effect until one loads).
    console.log("\n=== background mode smoke test ===");
    const bgButtons = await page.$$("#background-group button");
    for (const btn of bgButtons) {
      if (await btn.isDisabled()) continue;
      const label = await btn.textContent();
      await btn.click();
      await page.waitForTimeout(300);
      console.log(`clicked background: ${label}`);
    }
    await page.click("#background-group button"); // back to "Off"

    // Synthetic-mask alignment check: freeze the real segmentation model
    // (in case it actually loaded -- it needs a live network path to the
    // MediaPipe CDN, which may or may not be reachable from this sandbox,
    // and if it IS reachable it would otherwise overwrite our synthetic
    // mask every frame) and feed a hand-built mask that is foreground on
    // the raw-camera-space left half, background on the right half. If the
    // mirrored-vs-screen-space uv bookkeeping in GLRenderer is correct, the
    // composited foreground (video) should show up on the *right* side of
    // the screen (since the feed is mirrored) and the green background
    // should show on the *left*.
    console.log("\n=== mask alignment check ===");
    const diag = await page.evaluate(() => {
      const w = 64,
        h = 36;
      const mask = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          mask[y * w + x] = x < w / 2 ? 255 : 0;
        }
      }
      const argus = window.__argus;
      const segStatusBefore = argus.segmentation.status;
      argus.freezeSegmentation(true);
      argus.setBackgroundMode("color");
      argus.uploadTestMask(mask, w, h);
      return { segStatusBefore };
    });
    console.log("segmentation model status:", diag.segStatusBefore);
    await page.waitForTimeout(250);

    const pixelSample = await page.evaluate(() => {
      const c = document.getElementById("gl-canvas");
      const tmp = document.createElement("canvas");
      tmp.width = c.width;
      tmp.height = c.height;
      const ctx = tmp.getContext("2d");
      ctx.drawImage(c, 0, 0);
      const sampleAt = (fx, fy) => {
        const px = Math.floor(fx * tmp.width);
        const py = Math.floor(fy * tmp.height);
        const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
        return { r, g, b };
      };
      return { left: sampleAt(0.08, 0.5), right: sampleAt(0.92, 0.5) };
    });
    // Compare against the renderer's actual known background colour (set in
    // GLRenderer's constructor) rather than a generic "looks green" hue
    // heuristic -- the synthetic test video's own time-varying gradient can
    // coincidentally pass a loose hue check.
    const BG_COLOR = { r: 5, g: 216, b: 102 };
    const colorDistance = (p) => Math.hypot(p.r - BG_COLOR.r, p.g - BG_COLOR.g, p.b - BG_COLOR.b);
    const isBg = (p) => colorDistance(p) < 30;
    const leftIsBg = isBg(pixelSample.left);
    const rightIsBg = isBg(pixelSample.right);
    console.log("left px", pixelSample.left, leftIsBg ? "(green background, expected)" : "(NOT green)");
    console.log("right px", pixelSample.right, rightIsBg ? "(green background, UNEXPECTED)" : "(foreground, expected)");
    const maskAligned = leftIsBg && !rightIsBg;
    console.log(maskAligned ? "OK   mask alignment correct" : "FAIL mask alignment incorrect (mirrored?)");
    await page.screenshot({ path: "test/fixtures/mask-alignment.png" });

    await page.evaluate(() => window.__argus.setBackgroundMode("off"));
    await page.waitForTimeout(150);

    // Air-draw check: bypass the (network-gated) real hand-tracking model
    // via the debug hook and feed synthetic 21-point hand landmarks that
    // pinch (thumb tip + index tip close together, scaled by hand size)
    // across two frames, then confirm ink actually landed on draw-canvas.
    console.log("\n=== air draw check ===");
    const drawResult = await page.evaluate(() => {
      const c = document.getElementById("draw-canvas");
      const mkHand = (thumbX, indexX) => {
        const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
        lm[0] = { x: 0.5, y: 0.8, z: 0, visibility: 1 }; // wrist
        lm[9] = { x: 0.5, y: 0.6, z: 0, visibility: 1 }; // middle MCP (hand-size reference)
        lm[4] = { x: thumbX, y: 0.5, z: 0, visibility: 1 }; // thumb tip
        lm[8] = { x: indexX, y: 0.5, z: 0, visibility: 1 }; // index tip (the "pen")
        return lm;
      };
      const argus = window.__argus;
      argus.airDraw.clear();
      argus.airDraw.color = "#ff00ff";
      // Two pinched frames, index tip moving left-to-right (in landmark
      // space), so a stroke gets drawn between them. Both index-tip
      // landmarks sit at y=0.5, so the stroke is a horizontal segment.
      const indexX1 = 0.5;
      const indexX2 = 0.6;
      argus.airDraw.update([mkHand(0.48, indexX1)], c.width, c.height);
      argus.airDraw.update([mkHand(0.58, indexX2)], c.width, c.height);
      const ctx = c.getContext("2d");
      // Screen x is mirrored (1 - landmarkX) * width; average the two
      // mirrored endpoints to land squarely on the drawn stroke.
      const midX = Math.floor((((1 - indexX1) * c.width + (1 - indexX2) * c.width) / 2));
      const midY = Math.floor(0.5 * c.height);
      const inkPixel = ctx.getImageData(midX, midY, 1, 1).data;
      return { inkPixel: Array.from(inkPixel) };
    });
    const [ir, ig, ib, ia] = drawResult.inkPixel;
    const inkPresent = ia > 0 && ir > 100 && ib > 100 && ig < 100;
    console.log(`ink pixel rgba(${ir},${ig},${ib},${ia})`, inkPresent ? "(magenta ink found, expected)" : "(NOT found)");

    const clearedOk = await page.evaluate(() => {
      const c = document.getElementById("draw-canvas");
      window.__argus.airDraw.clear();
      const ctx = c.getContext("2d");
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      return data.every((v, i) => (i % 4 === 3 ? v === 0 : true)); // alpha channel all zero
    });
    console.log(clearedOk ? "OK   clear() wipes the canvas" : "FAIL clear() left residue");
    const airDrawOk = inkPresent && clearedOk;
    console.log(airDrawOk ? "OK   air draw" : "FAIL air draw");

    // Recording must produce a downloadable file and not throw.
    console.log("\n=== recording check ===");
    let recordingOk = true;
    try {
      const downloadPromise = page.waitForEvent("download", { timeout: 8000 });
      await page.click("#btn-record");
      await page.waitForTimeout(1000);
      await page.click("#btn-record");
      const download = await downloadPromise;
      console.log("OK   recording produced download:", download.suggestedFilename());
    } catch (err) {
      recordingOk = false;
      console.log("FAIL recording did not produce a download:", err.message);
    }

    await browser.close();

    let ok = true;
    console.log(`\n${feedOk ? "OK  " : "FAIL"} live feed renders a non-uniform frame`);
    if (!feedOk) ok = false;
    if (!maskAligned) ok = false;
    if (!airDrawOk) ok = false;
    if (!recordingOk) ok = false;
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
