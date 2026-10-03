import { createHash } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Each worktree gets its own test server port (nightshift runs phases in parallel worktrees),
// so a test never reuses a server that serves another checkout. PW_PORT overrides.
const PORT_RANGE_START = 5400;
const PORT_RANGE_SIZE = 500;
const cwdHash = createHash("sha1").update(process.cwd()).digest().readUInt32BE(0);
const PORT = Number(process.env.PW_PORT) || PORT_RANGE_START + (cwdHash % PORT_RANGE_SIZE);
const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal"];

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: GPU_ARGS },
  },
  projects: [
    { name: "smoke", testDir: "tests/smoke", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } } },
    { name: "e2e", testDir: "tests/e2e", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
