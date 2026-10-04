import { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";

/** The define that switches the SSAO pre-pass outputs of a material on. */
const PREPASS = "PREPASS";
/** Defines that only matter under `PREPASS` (every use in Babylon's shaders sits inside `#ifdef PREPASS`). */
const PREPASS_ONLY = /^(PREPASS_|SCENE_MRT_COUNT$)/;

/** What `MaterialDefines` keeps privately: its define names, in the order they were first set. */
interface DefinesKeys {
  _keys: string[];
}

/** A defines object's names in sorted order, recomputed when its name list changes (names are only ever added). */
interface SortedKeys {
  source: string[];
  length: number;
  sorted: string[];
  /** Per sorted name: it only matters under `PREPASS`. */
  prePassOnly: boolean[];
}

/**
 * Makes a material's defines string — the key of Babylon's shader cache — depend only on what the shader does, not on
 * the history of the mesh (FEEDBACK 2026-10-04, „po přepnutí na Nízké se přeloží shader“). Babylon keeps one defines
 * object per sub-mesh and prints it in the order the names were first set, so two meshes with the same material state
 * get different strings, i.e. two compiles of the same shader and two WebGPU pipelines:
 * - a mesh first lit by 1 light and later by 4 prints `LIGHT0 … LIGHTCOUNT MAXLIGHTCOUNT LIGHT1 …`, one lit by 4 from
 *   the start `LIGHT0 LIGHT1 … LIGHTCOUNT …`;
 * - when the SSAO pre-pass turns off (Vysoké/Střední → Nízké) Babylon clears `PREPASS` but leaves `PREPASS_COLOR`,
 *   the `PREPASS_*_INDEX` values and `SCENE_MRT_COUNT` set, so every mesh drawn before the switch prints them and
 *   every mesh first drawn after it (a respawned robot, a new decal) does not.
 * The shader warm-up after a preset change draws the meshes it can see, so the variant of the others was compiled at
 * their first appearance in play. Printing the names sorted, and leaving out the pre-pass-only ones while `PREPASS`
 * is off, gives every mesh in the same state the same string. Installed once, before any material is created; only
 * defines with a `PREPASS` name (mesh materials) are printed this way.
 */
export class CanonicalDefines {
  private static installed = false;
  private static readonly sortedKeys = new WeakMap<MaterialDefines, SortedKeys>();

  static install(): void {
    if (CanonicalDefines.installed) return;
    CanonicalDefines.installed = true;
    const original = MaterialDefines.prototype.toString;
    MaterialDefines.prototype.toString = function (this: MaterialDefines): string {
      // Only mesh materials have lights and a pre-pass: other defines (a particle system's image processing, printed
      // three times a frame per system) have a fixed set of names in a fixed order and keep Babylon's cheaper print.
      return (this as unknown as Record<string, unknown>)[PREPASS] === undefined ? original.call(this) : CanonicalDefines.print(this);
    };
  }

  private static print(defines: MaterialDefines): string {
    const values = defines as unknown as Record<string, unknown>;
    const prePass = values[PREPASS] === true;
    const { sorted, prePassOnly } = CanonicalDefines.sorted(defines);
    let result = "";
    for (let i = 0; i < sorted.length; i++) {
      if (!prePass && prePassOnly[i] === true) continue;
      const name = sorted[i]!;
      const value = values[name];
      if (typeof value === "number" || typeof value === "string") result += `#define ${name} ${value}\n`;
      else if (value) result += `#define ${name}\n`;
    }
    return result;
  }

  private static sorted(defines: MaterialDefines): SortedKeys {
    const keys = (defines as unknown as DefinesKeys)._keys;
    let entry = CanonicalDefines.sortedKeys.get(defines);
    if (entry === undefined || entry.source !== keys || entry.length !== keys.length) {
      const sorted = [...keys].sort();
      entry = { source: keys, length: keys.length, sorted, prePassOnly: sorted.map((name) => PREPASS_ONLY.test(name)) };
      CanonicalDefines.sortedKeys.set(defines, entry);
    }
    return entry;
  }
}
