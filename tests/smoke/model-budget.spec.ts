import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";

// Every primitive model (src/**/models/*Model.ts) registers itself in ModelRegistry; the `models` dev scene builds all
// of them. A model over the triangle budget of its category (data/models.json, DESIGN §13) fails here.

const READY_TIMEOUT_MS = 30_000;

function modelFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) modelFiles(path, out);
    else if (/\/models\/[^/]+Model\.ts$/.test(path)) out.push(path);
  }
  return out;
}

test("every registered model stays within its triangle budget", async ({ page }) => {
  const guard = new ConsoleGuard(page);
  await page.goto("/dev/?scene=models");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();

  const models = await page.evaluate(() => window.__game!.models!.list());
  const files = modelFiles("src").map((f) => f.replace(/^.*\//, "").replace(/\.ts$/, ""));
  // One registry entry per model file (a model class that forgets to register would escape the budget check).
  expect(models.map((m) => m.name).sort()).toEqual(files.sort());
  for (const model of models) {
    expect(model.triangles, `${model.name} (${model.category})`).toBeGreaterThan(0);
    expect(model.triangles, `${model.name} (${model.category}) over budget`).toBeLessThanOrEqual(model.budget);
  }
  expect(models.find((m) => m.name === "WaterPistolModel")?.budget).toBe(1000);
  expect(guard.problems).toEqual([]);
});
