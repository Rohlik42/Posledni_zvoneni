import { test } from "node:test";
import assert from "node:assert/strict";
import { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { CanonicalDefines } from "../../src/rendering/CanonicalDefines";

// FEEDBACK 2026-10-04 („po přepnutí na Nízké se přeloží shader“): a material's defines string is the key of Babylon's
// shader cache, so two meshes in the same material state must print the same string whatever their history.

CanonicalDefines.install();

/**
 * Defines of a mesh material (they always have `PREPASS`, like `StandardMaterialDefines`), the other names set in the
 * order of `entries` (Babylon adds a define name the first time it is set, then rebuilds).
 */
function defines(entries: [string, boolean | number][]): MaterialDefines {
  const d = new MaterialDefines();
  const values = d as unknown as Record<string, unknown>;
  values.PREPASS = false;
  for (const [name, value] of entries) values[name] = value;
  d.rebuild();
  return d;
}

test("the order the lights were first seen in does not change the string", () => {
  const lit4 = defines([["LIGHT0", true], ["HEMILIGHT0", true], ["LIGHT1", true], ["POINTLIGHT1", true], ["LIGHTCOUNT", 2], ["MAXLIGHTCOUNT", 8]]);
  const lit1then4 = defines([["LIGHT0", true], ["HEMILIGHT0", true], ["LIGHTCOUNT", 2], ["MAXLIGHTCOUNT", 8], ["LIGHT1", true], ["POINTLIGHT1", true]]);
  assert.equal(lit1then4.toString(), lit4.toString());
});

test("pre-pass leftovers are left out while PREPASS is off, printed while it is on", () => {
  const fresh = defines([["PREPASS", false], ["PREPASS_COLOR", false], ["PREPASS_COLOR_INDEX", -1], ["SCENE_MRT_COUNT", 0], ["FOG", true]]);
  const afterSsao = defines([["PREPASS", false], ["PREPASS_COLOR", true], ["PREPASS_COLOR_INDEX", 0], ["SCENE_MRT_COUNT", 3], ["FOG", true]]);
  assert.equal(afterSsao.toString(), fresh.toString());
  assert.equal(fresh.toString(), "#define FOG\n");
  const withSsao = defines([["PREPASS", true], ["PREPASS_COLOR", true], ["PREPASS_COLOR_INDEX", 0], ["SCENE_MRT_COUNT", 3], ["FOG", true]]);
  assert.equal(withSsao.toString(), "#define FOG\n#define PREPASS\n#define PREPASS_COLOR\n#define PREPASS_COLOR_INDEX 0\n#define SCENE_MRT_COUNT 3\n");
});

test("defines without PREPASS (a particle system's image processing) keep Babylon's own order", () => {
  const d = new MaterialDefines();
  const values = d as unknown as Record<string, unknown>;
  values.VIGNETTE = true;
  values.EXPOSURE = true;
  d.rebuild();
  assert.equal(d.toString(), "#define VIGNETTE\n#define EXPOSURE\n");
});

test("numbers and strings are printed with their value, false flags are not printed", () => {
  const d = defines([["NUM_BONE_INFLUENCERS", 0], ["ALPHATEST", false], ["NORMAL", true]]);
  assert.equal(d.toString(), "#define NORMAL\n#define NUM_BONE_INFLUENCERS 0\n");
  // A define added later (a new light) shows up.
  (d as unknown as Record<string, unknown>).LIGHT0 = true;
  d.rebuild();
  assert.equal(d.toString(), "#define LIGHT0\n#define NORMAL\n#define NUM_BONE_INFLUENCERS 0\n");
});
