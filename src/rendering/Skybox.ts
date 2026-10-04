import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { TestHooks } from "../core/TestHooks";
import { SkyboxConfig, type SkyboxData } from "./SkyboxConfig";

/** Babylon's six-file cube order. */
const FACES = ["_px", "_py", "_pz", "_nx", "_ny", "_nz"] as const;
const DEG = Math.PI / 180;

export interface SkyTestApi {
  readonly enabled: boolean;
  /** The cube texture finished loading. */
  ready: () => boolean;
  readonly size: number;
  /** Edge of a loaded cube face in px (phase 21: 1024 on the low preset, else 2048); 0 when disabled. */
  readonly faceSize: number;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    sky: SkyTestApi;
  }
}

/**
 * The night panorama of Prague around the school (FEEDBACK 2026-10-03: one continuous view instead of a small picture
 * per window). A cube map from `tools/prague-skybox.ts` on an inside-out box that follows the camera
 * (`infiniteDistance`): unlit, without fog, not pickable, so hitscan and robot vision ignore it. Windows are just
 * glass; what is seen through them is this sky.
 */
export class Skybox {
  private faceEdge: number;

  private constructor(
    readonly mesh: Mesh,
    private cube: CubeTexture,
    private readonly data: SkyboxData,
    faceSize: number,
  ) {
    this.faceEdge = faceSize;
  }

  /**
   * The skybox with faces of at least `faceSize` px when a variant of `data/sky.json` has them (phase 21: the low
   * quality preset loads the 1024² copy), else the full texture.
   */
  static create(scene: Scene, data: SkyboxData = SkyboxConfig.load(), faceSize: number = data.faceSize): Skybox | null {
    if (!data.enabled) {
      TestHooks.register("sky", { enabled: false, ready: () => false, size: 0, faceSize: 0 });
      return null;
    }
    const chosen = SkyboxConfig.pick(data, faceSize);
    const texture = Skybox.texture(scene, data, chosen.texture);

    const material = new StandardMaterial("skybox", scene);
    material.backFaceCulling = false;
    material.reflectionTexture = texture;
    material.disableLighting = true;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.fogEnabled = false;

    const mesh = CreateBox("skybox", { size: data.size }, scene);
    mesh.material = material;
    mesh.infiniteDistance = true;
    mesh.isPickable = false;
    mesh.applyFog = false;
    const skybox = new Skybox(mesh, texture, data, chosen.faceSize);
    TestHooks.register("sky", {
      enabled: true,
      ready: () => skybox.cube.isReady(),
      size: data.size,
      get faceSize() {
        return skybox.faceEdge;
      },
    });
    return skybox;
  }

  get texture(): CubeTexture {
    return this.cube;
  }

  get faceSize(): number {
    return this.faceEdge;
  }

  /** Swaps the cube map for the variant fitting `faceSize` (quality presets); the old one is freed once the new one loaded. */
  setFaceSize(faceSize: number): void {
    const chosen = SkyboxConfig.pick(this.data, faceSize);
    if (chosen.faceSize === this.faceEdge) return;
    const material = this.mesh.material as StandardMaterial;
    const next = Skybox.texture(this.mesh.getScene(), this.data, chosen.texture);
    this.cube = next;
    this.faceEdge = chosen.faceSize;
    next.onLoadObservable.addOnce(() => {
      // Superseded by another swap while loading.
      if (this.cube !== next) {
        next.dispose();
        return;
      }
      const shown = material.reflectionTexture;
      material.reflectionTexture = next;
      if (shown !== next) shown?.dispose();
    });
  }

  private static texture(scene: Scene, data: SkyboxData, path: string): CubeTexture {
    const texture = new CubeTexture(
      `${import.meta.env.BASE_URL}${path}`,
      scene,
      FACES.map((face) => `${face}${data.extension}`),
    );
    texture.coordinatesMode = Texture.SKYBOX_MODE;
    texture.rotationY = data.yawDeg * DEG;
    texture.level = data.level;
    return texture;
  }
}
