import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { Scene } from "@babylonjs/core/scene";
// glTF 2.0 only: the file loader plugin, the 2.0 loader and the one extension the optimized files need
// (tools/optimize-people.ts quantizes vertices). No Draco/meshopt — nothing is fetched from a CDN.
import "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization";
import { PeopleConfig } from "./PeopleConfig";

const GLB_EXTENSION = ".glb";

/** A material with a light limit (StandardMaterial, PBRMaterial…). */
interface LightLimited {
  maxSimultaneousLights: number;
}
/** GLTFLoaderAnimationStartMode.NONE: nothing plays on load; PersonModel starts its own clips per instance. */
const ANIMATION_START_NONE = 0;

/**
 * The glTF people of `data/people.json`, each file loaded once per scene into an `AssetContainer` (never added to the
 * scene itself); `PersonModel` instantiates them. Loading is asynchronous, so whoever builds people awaits `preload`
 * first (LevelGameplay, the teacher and gallery dev scenes); building then stays synchronous.
 */
export class PeopleLibrary {
  private static readonly loading = new WeakMap<Scene, Map<string, Promise<AssetContainer>>>();
  private static readonly loaded = new WeakMap<Scene, Map<string, AssetContainer>>();

  /**
   * Loads the given models (default: all of `data/people.json`) into `scene`; already loaded ones are reused. Await it
   * before building the rest of the scene: Babylon's glTF loader raises `maxSimultaneousLights` of every material in
   * the scene to the scene's light count when a file finishes, so the values from before the load are put back here;
   * a material created while the files load would keep the raised value (and warn on WebGPU).
   */
  static async preload(scene: Scene, ids: readonly string[] = PeopleConfig.ids()): Promise<void> {
    let pending = PeopleLibrary.loading.get(scene);
    if (pending === undefined) {
      pending = new Map();
      PeopleLibrary.loading.set(scene, pending);
    }
    let done = PeopleLibrary.loaded.get(scene);
    if (done === undefined) {
      done = new Map();
      PeopleLibrary.loaded.set(scene, done);
    }
    const ready = done;
    const requests = pending;
    const lightLimits = PeopleLibrary.lightLimits(scene);
    await Promise.all(
      [...new Set(ids)].map((id) => {
        let request = requests.get(id);
        if (request === undefined) {
          request = LoadAssetContainerAsync(PeopleLibrary.url(id), scene, {
            pluginExtension: GLB_EXTENSION,
            pluginOptions: { gltf: { animationStartMode: ANIMATION_START_NONE } },
          }).then((container) => {
            ready.set(id, container);
            return container;
          });
          requests.set(id, request);
        }
        return request;
      }),
    );
    for (const [material, limit] of lightLimits) material.maxSimultaneousLights = limit;
  }

  /** The loaded container of model `id`; throws when `preload` did not load it into this scene. */
  static container(scene: Scene, id: string): AssetContainer {
    const container = PeopleLibrary.loaded.get(scene)?.get(id);
    if (container === undefined) throw new Error(`PeopleLibrary: person model "${id}" is not loaded (await PeopleLibrary.preload first)`);
    return container;
  }

  /** `maxSimultaneousLights` of every material of the scene that has one. */
  private static lightLimits(scene: Scene): Map<LightLimited, number> {
    const limits = new Map<LightLimited, number>();
    for (const material of scene.materials) {
      const limited = material as Partial<LightLimited>;
      if (typeof limited.maxSimultaneousLights === "number") limits.set(limited as LightLimited, limited.maxSimultaneousLights);
    }
    return limits;
  }

  /** URL of the model under the Vite base URL (`./` relative on GitHub Pages). */
  static url(id: string): string {
    const { directory } = PeopleConfig.load();
    return `${import.meta.env.BASE_URL}${directory}${PeopleConfig.model(id).file}`;
  }
}
