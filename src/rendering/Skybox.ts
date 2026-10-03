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
  private constructor(
    readonly mesh: Mesh,
    readonly texture: CubeTexture,
  ) {}

  static create(scene: Scene, data: SkyboxData = SkyboxConfig.load()): Skybox | null {
    if (!data.enabled) {
      TestHooks.register("sky", { enabled: false, ready: () => false, size: 0 });
      return null;
    }
    const texture = new CubeTexture(
      `${import.meta.env.BASE_URL}${data.texture}`,
      scene,
      FACES.map((face) => `${face}${data.extension}`),
    );
    texture.coordinatesMode = Texture.SKYBOX_MODE;
    texture.rotationY = data.yawDeg * DEG;
    texture.level = data.level;

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
    const skybox = new Skybox(mesh, texture);
    TestHooks.register("sky", { enabled: true, ready: () => texture.isReady(), size: data.size });
    return skybox;
  }
}
