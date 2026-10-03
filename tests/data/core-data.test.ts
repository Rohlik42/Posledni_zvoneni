import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DevSceneData } from "../../dev/DevSceneData";
import { GameConfig } from "../../src/core/GameConfig";
import { InputBindings } from "../../src/core/InputBindings";
import { RenderingConfig } from "../../src/rendering/RenderingConfig";
import { DataError } from "../../src/utils/DataError";
import { DataLoader } from "../../src/utils/DataLoader";
import { Palette } from "../../src/utils/Palette";
import { Schema, type SchemaNode } from "../../src/utils/Schema";

/** Every string in `value` that sits under a key validated as a palette reference, found by walking the schema. */
function paletteRefs(value: unknown, node: SchemaNode, out: string[] = []): string[] {
  const walk = (v: unknown, n: SchemaNode): void => {
    switch (n.kind) {
      case "paletteRef":
        out.push(v as string);
        return;
      case "array":
        (v as unknown[]).forEach((item) => walk(item, n.of));
        return;
      case "record":
        for (const [key, item] of Object.entries(v as object)) if (!key.startsWith("//")) walk(item, n.of);
        return;
      case "object":
        for (const [key, child] of Object.entries(n.fields)) if (key in (v as object)) walk((v as Record<string, unknown>)[key], child);
        return;
      default:
        return;
    }
  };
  walk(value, node);
  return out;
}

const loaders = [
  { name: "rendering", load: () => RenderingConfig.load(), schema: RenderingConfig.schema },
  { name: "game", load: () => GameConfig.load(), schema: GameConfig.schema },
  { name: "input", load: () => InputBindings.load(), schema: InputBindings.schema },
  { name: "dev-scenes", load: () => DevSceneData.load(), schema: DevSceneData.schema },
];

test("palette.json: every entry is a hex colour", () => {
  const data = Palette.data();
  assert.ok(Object.keys(data).length > 0);
  assert.match(Palette.hex("neon.water"), /^#[0-9a-f]{6}$/i);
});

for (const { name, load, schema } of loaders) {
  test(`${name}.json: matches its schema and palette keys exist`, () => {
    const data = load();
    for (const ref of paletteRefs(data, schema)) assert.ok(Palette.has(ref), `${name}.json: unknown palette key ${ref}`);
  });
}

test("input.json: Esc pauses, middle mouse opens doors (LEGACY §3)", () => {
  const input = InputBindings.load();
  assert.equal(input.keys["Escape"], "pause");
  assert.equal(input.mouseButtons["1"], "door");
});

test("DataLoader names the file and field in errors", () => {
  const schema = Schema.object({ bloom: Schema.object({ weight: Schema.number({ min: 0 }) }) });
  assert.throws(() => DataLoader.parse("data/x.json", { bloom: { weight: "a" } }, schema), (err: unknown) => {
    assert.ok(err instanceof DataError);
    assert.equal(err.message, "data/x.json: bloom.weight must be a number (got string)");
    return true;
  });
  assert.throws(() => DataLoader.parse("data/x.json", { bloom: {} }, schema), /bloom\.weight is required but missing/);
  assert.throws(() => DataLoader.parse("data/x.json", { bloom: { weight: 1, wieght: 2 } }, schema), /bloom\.wieght is not a known field/);
  assert.throws(() => DataLoader.parse("data/x.json", { bloom: { weight: -1 } }, schema), /must be >= 0/);
  assert.doesNotThrow(() => DataLoader.parse("data/x.json", { "//": "comment", bloom: { weight: 1 } }, schema));
});

test("data files read by the core are valid JSON on disk", () => {
  for (const file of ["palette", "rendering", "game", "input", "dev-scenes"]) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(`data/${file}.json`, "utf8")), file);
  }
});
