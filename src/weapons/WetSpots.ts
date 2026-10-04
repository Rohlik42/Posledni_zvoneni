import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateDecal } from "@babylonjs/core/Meshes/Builders/decalBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { EffectBudget } from "../rendering/EffectBudget";
import { LightExclusions } from "../rendering/LightExclusions";
import { PaletteColor } from "../rendering/PaletteColor";
import { ShaderPrewarm } from "../rendering/ShaderPrewarm";
import { ParticleTextures } from "../rendering/ParticleTextures";
import type { Random } from "../utils/Random";
import type { StreamData } from "./WeaponConfig";

/** Pulls the decal towards the camera in the depth test so it never flickers against the surface it lies on. */
const DECAL_Z_OFFSET = -2;
const FULL_TURN = Math.PI * 2;
/** Edge of the warm-up stand-ins (m); they are drawn only during the shader warm-up. */
const PREWARM_SIZE = 0.1;
/**
 * Vertical stretch of the warm-up stand-ins: a spot on a wall has a uniform world scale, one on a stretched robot part
 * a non-uniform one, which is another shader define (`NONUNIFORMSCALING`), so one stand-in of each is drawn.
 */
const PREWARM_STRETCH = [1, 2] as const;

interface WetSpot {
  mesh: Mesh;
  age: number;
}

/**
 * Wet patches where water hits: a blob-shaped decal projected onto the hit mesh (parented to it, so it moves with a
 * falling target), fading out over the last `wetFade` seconds of `wetLifetime`. At most `maxWetSpots` exist; the
 * oldest is removed first. Ages advance in the fixed simulation step.
 */
export class WetSpots {
  private readonly material: StandardMaterial;
  private readonly spots: WetSpot[] = [];
  private serial = 0;
  /** The quality preset's cap on wet spots (FEEDBACK 2026-10-04); the weapon's own `maxWetSpots` still applies. */
  private readonly budget: EffectBudget;
  private readonly proxies: Mesh[];

  constructor(
    scene: Scene,
    private readonly data: StreamData,
    private readonly random: Random,
  ) {
    const material = new StandardMaterial("wet-spot", scene);
    material.diffuseTexture = ParticleTextures.blob(scene);
    material.useAlphaFromDiffuseTexture = true;
    material.diffuseColor = PaletteColor.color3(data.colorDeep);
    material.emissiveColor = PaletteColor.emissive(data.colorDeep, data.wetGlow);
    material.specularColor = Color3.Black();
    material.alpha = data.wetAlpha;
    material.zOffset = DECAL_Z_OFFSET;
    material.disableDepthWrite = true;
    this.material = material;
    this.budget = EffectBudget.for(scene);
    // Hidden stand-ins with the decal's vertex layout (positions, normals, UVs) are
    // drawn in the shader warm-up, so the first wet spot of a fight builds no shader (FEEDBACK 2026-10-04).
    this.proxies = PREWARM_STRETCH.map((stretch) => {
      const proxy = CreatePlane(`wet-spot-prewarm-${data.colorDeep}-${stretch}`, { size: PREWARM_SIZE }, scene);
      proxy.material = material;
      proxy.isPickable = false;
      proxy.scaling.y = stretch;
      proxy.setEnabled(false);
      ShaderPrewarm.for(scene).addMesh(proxy);
      return proxy;
    });
  }

  /** Wet spots kept at most: the weapon's `maxWetSpots`, capped by the preset's budget. */
  private get max(): number {
    return Math.min(this.data.maxWetSpots, this.budget.wetSpots);
  }

  get count(): number {
    return this.spots.length;
  }

  add(target: AbstractMesh, point: Vector3, normal: Vector3): void {
    if (this.max === 0) return;
    const size = this.random.range(this.data.wetSize[0], this.data.wetSize[1]);
    let mesh: Mesh;
    try {
      mesh = CreateDecal(`wet-spot-${this.serial++}`, target, {
        position: point,
        normal,
        size: new Vector3(size, size, this.data.wetDepth),
        angle: this.random.range(0, FULL_TURN),
        localMode: true,
      });
    } catch {
      return; // Meshes without index/normal data (e.g. lines) cannot carry a decal.
    }
    if (mesh.getTotalVertices() === 0) {
      mesh.dispose();
      return;
    }
    mesh.parent = target;
    LightExclusions.exclude(mesh);
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.renderingGroupId = target.renderingGroupId;
    this.spots.push({ mesh, age: 0 });
    while (this.spots.length > this.max) this.spots.shift()?.mesh.dispose();
  }

  update(dt: number): void {
    const fadeStart = this.data.wetLifetime - this.data.wetFade;
    for (const spot of this.spots) {
      spot.age += dt;
      spot.mesh.visibility = spot.age <= fadeStart ? 1 : Math.max(0, 1 - (spot.age - fadeStart) / Math.max(this.data.wetFade, dt));
    }
    while (this.spots.length > 0 && (this.spots[0]?.age ?? 0) >= this.data.wetLifetime) this.spots.shift()?.mesh.dispose();
  }

  dispose(): void {
    for (const spot of this.spots) spot.mesh.dispose();
    this.spots.length = 0;
    for (const proxy of this.proxies) proxy.dispose();
    this.material.dispose();
  }
}
