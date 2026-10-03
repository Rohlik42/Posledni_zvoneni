import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { AssetCredits } from "../../src/ui/AssetCredits";
import { MenuConfig, QUALITY_OPTIONS } from "../../src/ui/MenuConfig";

// Phase 18 data: menu.json (texts, settings ranges, quality options, the link to the old game) and the credits list
// parsed from ASSETS.md.

const data = MenuConfig.load();

test("menu.json: schema, settings defaults inside their ranges, quality options, legacy link points at the old game", () => {
  for (const name of ["mouseSensitivity", "volume"] as const) {
    const r = data.settings[name];
    assert.ok(r.min < r.max && r.default >= r.min && r.default <= r.max, name);
    assert.ok(r.step <= r.max - r.min, `${name}: step fits the range`);
  }
  assert.ok(data.settings.volume.min >= 0 && data.settings.volume.max <= 1, "volume is a 0–1 gain");
  assert.ok(data.settings.mouseSensitivity.min > 0, "sensitivity never zero");
  assert.equal(new Set(data.qualityOptions).size, data.qualityOptions.length, "quality options unique");
  assert.ok(data.qualityOptions.includes(data.settings.quality), "default quality is offered");
  for (const option of QUALITY_OPTIONS) {
    assert.ok(data.texts.quality.options[option].length > 0 && data.texts.quality.details[option].length > 0, option);
  }
  assert.ok(existsSync(data.legacyUrl.replace(/\/$/, "/index.html")), `legacy link ${data.legacyUrl} exists in the repo`);
  // Every checkpoint label LevelProgress saves (start + the key colours) has a menu text.
  for (const label of ["start", "red", "yellow", "blue"]) assert.ok(data.texts.main.checkpointLabels[label], label);
});

test("credits: ASSETS.md table rows, three filled cells each, code ticks dropped, pipes inside code kept", () => {
  const markdown = readFileSync("ASSETS.md", "utf8");
  const credits = AssetCredits.parse(markdown);
  const tableRows = markdown.split("\n").filter((l) => l.trim().startsWith("|")).length;
  // header + separator are not credits
  assert.equal(credits.length, tableRows - 2);
  for (const credit of credits) {
    assert.ok(credit.file.length > 0 && credit.source.length > 0 && credit.license.length > 0, JSON.stringify(credit));
    assert.ok(!credit.file.includes("`"), credit.file);
  }
  assert.ok(credits.some((c) => c.file.startsWith("reference/matterport")), "Matterport row");
  assert.ok(credits.some((c) => c.license.includes("CC0")), "Poly Haven rows");
  const parsed = AssetCredits.parse("| a | b | c |\n| --- | --- | --- |\n| `x|y` | src | lic |\n");
  assert.deepEqual(parsed, [{ file: "x|y", source: "src", license: "lic" }]);
});
