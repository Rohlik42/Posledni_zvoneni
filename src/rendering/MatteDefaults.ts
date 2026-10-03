import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";

/** Specular power of matte materials (irrelevant with a black specular colour, kept low for clarity). */
const MATTE_SPECULAR_POWER = 1;

/** `material.metadata.keepSpecular = true` opts a material out (a deliberate highlight, e.g. a later water effect). */
export interface SpecularOptOut {
  keepSpecular?: boolean;
}

/**
 * Scene-wide rule of the flat low-poly look: **no specular highlights**. Every `StandardMaterial` created in the scene
 * gets a black `specularColor` before it is first rendered, whoever created it (level, box room, models, effects,
 * later phases).
 *
 * Why: Babylon's default white specular makes point-light highlights that slide over walls with the camera, which
 * reads as a torch carried by the player (FEEDBACK.md 2026-10-03). Call sites that already set black keep working;
 * this is the safety net that makes it true for all materials.
 *
 * Babylon announces a material in the base `Material` constructor, before `StandardMaterial`'s own field initialisers
 * set the white default, so the fix-up is queued and applied in `onBeforeRender` (always after the constructor
 * returned and before any frame uses the material).
 */
export class MatteDefaults {
  private static readonly installed = new WeakSet<Scene>();

  /**
   * A new matte `StandardMaterial`: black specular, specular power 1. The one place that sets up "no highlights" for
   * materials the game creates itself (MaterialLibrary, BoxRoom, FlatMaterials); `install` is the net for the rest.
   */
  static material(name: string, scene: Scene): StandardMaterial {
    const material = new StandardMaterial(name, scene);
    MatteDefaults.apply(material);
    material.specularPower = MATTE_SPECULAR_POWER;
    return material;
  }

  static install(scene: Scene): void {
    if (MatteDefaults.installed.has(scene)) return;
    MatteDefaults.installed.add(scene);
    const pending: Material[] = [];
    scene.onNewMaterialAddedObservable.add((material) => {
      pending.push(material);
    });
    scene.onBeforeRenderObservable.add(() => {
      while (pending.length > 0) {
        const material = pending.pop();
        if (material !== undefined) MatteDefaults.apply(material);
      }
    });
    // Materials that existed before the hook (none in practice: Game installs it right after creating the scene).
    for (const material of scene.materials) pending.push(material);
  }

  /** Largest specular colour channel over the scene's StandardMaterials (0 = no highlights anywhere). */
  static maxSpecular(scene: Scene): number {
    let max = 0;
    for (const material of scene.materials) {
      if (!(material instanceof StandardMaterial) || MatteDefaults.optedOut(material)) continue;
      const { r, g, b } = material.specularColor;
      max = Math.max(max, r, g, b);
    }
    return max;
  }

  private static apply(material: Material): void {
    if (!(material instanceof StandardMaterial) || MatteDefaults.optedOut(material)) return;
    // A fresh colour, not set() in place: the instance might be shared with something else (a light colour).
    material.specularColor = Color3.Black();
  }

  private static optedOut(material: Material): boolean {
    return (material.metadata as SpecularOptOut | null)?.keepSpecular === true;
  }
}
