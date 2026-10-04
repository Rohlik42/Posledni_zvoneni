import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DevSceneData } from "../../dev/DevSceneData";
import { GameConfig } from "../../src/core/GameConfig";
import { CheatCodes } from "../../src/core/CheatCodes";
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

test("input.json: every mouse button and wheel action also has a key; look keys and Enter are bound (FEEDBACK 2026-10-04, touchpad)", () => {
  const input = InputBindings.load();
  const keyed = new Set(Object.values(input.keys));
  const mouse = [...Object.values(input.mouseButtons), input.wheel.up, input.wheel.down];
  for (const action of mouse) assert.ok(keyed.has(action), `mouse action "${action}" has no key in input.json`);
  for (const action of ["lookLeft", "lookRight", "lookUp", "lookDown", "lockPointer"] as const) assert.ok(keyed.has(action), `"${action}" has no key`);
  assert.ok(input.keyLook.yawSpeed > 0 && input.keyLook.pitchSpeed > 0);
});

test("input.json: cheat codes are letters A–Z, unique, none a prefix of another; CheatCodes matches them", () => {
  const input = InputBindings.load();
  const codes = Object.values(input.cheats.codes).map((c) => c.toUpperCase());
  for (const code of codes) assert.match(code, /^[A-Z]{3,}$/);
  for (const a of codes) for (const b of codes) if (a !== b) assert.ok(!b.startsWith(a), `${a} is a prefix of ${b}`);
  const matcher = new CheatCodes(input.cheats);
  const type = (text: string, start = 0): (string | null)[] => [...text].map((ch, i) => matcher.feed(`Key${ch}`, start + i).cheat);
  // Wrong letters in between, then the full code: only the last letter completes it.
  assert.deepEqual(type(`ID${input.cheats.codes.god}`).at(-1), "god");
  assert.equal(type(input.cheats.codes.arsenal, 1000).at(-1), "arsenal");
  // Too slow between two letters: starts over.
  matcher.reset();
  const code = input.cheats.codes.noclip;
  for (let i = 0; i < code.length - 1; i++) matcher.feed(`Key${code[i]}`, 10_000 + i);
  assert.equal(matcher.feed(`Key${code.at(-1)}`, 10_000 + input.cheats.timeoutMs * 2).cheat, null);
  // Only letters continuing a code from its second letter on are swallowed.
  matcher.reset();
  assert.equal(matcher.feed("KeyI", 50_000).swallow, false);
  assert.equal(matcher.feed("KeyD", 50_001).swallow, true);
  assert.equal(matcher.feed("KeyW", 50_002).swallow, false);
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
