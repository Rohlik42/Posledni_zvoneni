import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Every data file must be valid JSON. Phase-specific schema tests live next to this file.
test("data/*.json parse", () => {
  for (const file of readdirSync("data").filter((f) => f.endsWith(".json"))) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(`data/${file}`, "utf8")), file);
  }
});
