// Takes a screenshot of a running dev server page once `window.__game.ready` is set.
// Usage: npx tsx tools/screenshot.ts <url> <out.png> [waitMs] [width] [height]
// CLICK=1 clicks the middle of the page once after load (pointer lock request, like a player would).
// Example: npx tsx tools/screenshot.ts "http://localhost:5301/dev/?scene=pipeline" screenshots/01-pipeline.png
import { chromium } from "@playwright/test";

const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal"];
const READY_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_MS = 1000;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

const [url, out, waitArg, widthArg, heightArg] = process.argv.slice(2);
if (url === undefined || out === undefined) {
  console.error("usage: tsx tools/screenshot.ts <url> <out.png> [waitMs] [width] [height]");
  process.exit(2);
}

const browser = await chromium.launch({ args: GPU_ARGS });
try {
  const page = await browser.newPage({ viewport: { width: Number(widthArg ?? DEFAULT_WIDTH), height: Number(heightArg ?? DEFAULT_HEIGHT) } });
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  if (process.env.CLICK === "1") {
    const size = page.viewportSize();
    if (size !== null) await page.mouse.click(size.width / 2, size.height / 2);
  }
  await page.waitForTimeout(Number(waitArg ?? DEFAULT_WAIT_MS));
  await page.screenshot({ path: out });
  const state = await page.evaluate(() => ({ renderer: window.__game?.renderer, error: window.__game?.error, fps: window.__game?.fps(), paused: window.__game?.paused, lookMode: window.__game?.input?.lookMode() }));
  console.log(JSON.stringify({ out, ...state, problems }));
} finally {
  await browser.close();
}
