// Z-fighting audit of the built level (FEEDBACK 2026-10-03 „problikávání“, phase F1): opens the `level` dev scene in
// headless Chromium, runs `__game.level.audit()` (GeometryAudit over every rendered static mesh) and prints a table of
// coplanar overlapping faces: rooms, materials, facing, normal, world position, overlap area, meshes.
// Usage: npm run tool tools/geometry-audit.ts [devServerUrl]
//   Without a URL it starts its own Vite dev server on a free port and stops it afterwards.
// Exit code 1 when anything is found (usable as a check).
import { chromium } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal"];
const READY_TIMEOUT_MS = 60_000;

let server: ViteDevServer | null = null;
let base = process.argv[2];
if (base === undefined) {
  server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "error" });
  await server.listen();
  base = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
  if (base === undefined) throw new Error("geometry-audit: Vite did not report a local URL");
}

const browser = await chromium.launch({ args: GPU_ARGS });
let found = 0;
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto(`${base}/dev/?scene=level`);
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  const error = await page.evaluate(() => window.__game?.error ?? null);
  if (error !== null) throw new Error(`level scene failed: ${error}`);
  const result = await page.evaluate(() => {
    const level = window.__game!.level!;
    const t0 = performance.now();
    const findings = level.audit();
    return { count: findings.length, ms: Math.round(performance.now() - t0), table: level.auditTable(), triangles: level.triangles };
  });
  found = result.count;
  console.log(`${result.count} z-fighting findings (${result.triangles} rendered triangles, audit ${result.ms} ms)`);
  if (result.count > 0) console.log(result.table);
} finally {
  await browser.close();
  await server?.close();
}
process.exit(found > 0 ? 1 : 0);
