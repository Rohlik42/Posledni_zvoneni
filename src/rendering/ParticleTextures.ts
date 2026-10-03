import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

const DOT_SIZE_PX = 32;
const BLOB_SIZE_PX = 64;
/** Radial gradient stops (offset, alpha) of the soft droplet sprite. */
const DOT_STOPS: ReadonlyArray<[number, number]> = [
  [0, 1],
  [0.45, 0.85],
  [1, 0],
];
/** A wet spot is a blobby disc: a few overlapping circles with soft edges (offset x, offset y, radius, all × size). */
const BLOB_CIRCLES: ReadonlyArray<[number, number, number]> = [
  [0.5, 0.5, 0.34],
  [0.36, 0.42, 0.2],
  [0.64, 0.58, 0.2],
  [0.55, 0.32, 0.14],
  [0.4, 0.66, 0.15],
];
const BLOB_SOFT_EDGE = 0.7;

/**
 * Procedural sprites drawn into canvases once per scene (no image files): a soft white dot for particles and a white
 * blob with soft edges for wet spots. Colour comes from the particle system or material, not from the texture.
 */
export class ParticleTextures {
  private static readonly dots = new WeakMap<Scene, DynamicTexture>();
  private static readonly blobs = new WeakMap<Scene, DynamicTexture>();

  static dot(scene: Scene): DynamicTexture {
    let texture = ParticleTextures.dots.get(scene);
    if (texture === undefined) {
      texture = new DynamicTexture("particle-dot", { width: DOT_SIZE_PX, height: DOT_SIZE_PX }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
      const ctx = texture.getContext();
      const r = DOT_SIZE_PX / 2;
      const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
      for (const [offset, alpha] of DOT_STOPS) gradient.addColorStop(offset, `rgba(255,255,255,${alpha})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, DOT_SIZE_PX, DOT_SIZE_PX);
      texture.hasAlpha = true;
      texture.update();
      ParticleTextures.dots.set(scene, texture);
    }
    return texture;
  }

  static blob(scene: Scene): DynamicTexture {
    let texture = ParticleTextures.blobs.get(scene);
    if (texture === undefined) {
      texture = new DynamicTexture("wet-blob", { width: BLOB_SIZE_PX, height: BLOB_SIZE_PX }, scene, true, Texture.BILINEAR_SAMPLINGMODE);
      const ctx = texture.getContext();
      ctx.clearRect(0, 0, BLOB_SIZE_PX, BLOB_SIZE_PX);
      for (const [x, y, radius] of BLOB_CIRCLES) {
        const cx = x * BLOB_SIZE_PX;
        const cy = y * BLOB_SIZE_PX;
        const r = radius * BLOB_SIZE_PX;
        const gradient = ctx.createRadialGradient(cx, cy, r * BLOB_SOFT_EDGE, cx, cy, r);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      texture.hasAlpha = true;
      texture.update();
      ParticleTextures.blobs.set(scene, texture);
    }
    return texture;
  }
}
