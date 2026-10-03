import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { PaletteColor } from "./PaletteColor";

export interface FlatMaterialOptions {
  /** Self-illumination as a fraction of the colour (1 = full colour without light; above 1 reaches bloom). */
  emissive?: number;
  alpha?: number;
  maxSimultaneousLights?: number;
  /** Multiplies the diffuse colour (how strongly lights act on it); emissive is unaffected. */
  diffuseScale?: number;
}

/**
 * Shared matte materials for primitive models: diffuse colour from the palette, **black specular** (the low-poly flat
 * style has no highlights; a white specular makes surfaces react to the camera like a torch, FEEDBACK 2026-10-03) and
 * an optional emissive share. One material per (scene, colour, options), so parts of the same colour share it.
 */
export class FlatMaterials {
  private static readonly caches = new WeakMap<Scene, Map<string, StandardMaterial>>();

  static get(scene: Scene, paletteRef: string, options: FlatMaterialOptions = {}): StandardMaterial {
    let cache = FlatMaterials.caches.get(scene);
    if (cache === undefined) {
      cache = new Map();
      FlatMaterials.caches.set(scene, cache);
    }
    const emissive = options.emissive ?? 0;
    const alpha = options.alpha ?? 1;
    const diffuseScale = options.diffuseScale ?? 1;
    const key = `${paletteRef}|${emissive}|${alpha}|${diffuseScale}|${options.maxSimultaneousLights ?? ""}`;
    let material = cache.get(key);
    if (material === undefined) {
      const created = new StandardMaterial(`flat-${key}`, scene);
      created.diffuseColor = PaletteColor.color3(paletteRef).scale(diffuseScale);
      created.specularColor = Color3.Black();
      created.emissiveColor = PaletteColor.emissive(paletteRef, emissive);
      created.alpha = alpha;
      if (options.maxSimultaneousLights !== undefined) created.maxSimultaneousLights = options.maxSimultaneousLights;
      const owner = cache;
      created.onDisposeObservable.add(() => owner.delete(key));
      cache.set(key, created);
      material = created;
    }
    return material;
  }
}
