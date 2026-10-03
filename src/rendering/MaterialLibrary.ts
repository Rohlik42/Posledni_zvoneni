import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { PaletteKey } from "../utils/Palette";
import { Palette } from "../utils/Palette";
import { MaterialsConfig, type MaterialDef, type MaterialFallback, type MaterialsData } from "./MaterialsConfig";
import { MatteDefaults } from "./MatteDefaults";
import { PaletteColor } from "./PaletteColor";

/** One entry of `public/textures/index.json` (written by the phase 7 tools). */
export interface TextureEntry {
  id: string;
  /** Path relative to `public/`. */
  file: string;
  px: [number, number];
  /** Metres covered by one repeat of the texture. */
  sizeM: [number, number];
  tiling: "repeat" | "repeat-x" | "clamp" | "decal";
  plan?: { floor: number; rectPx: [number, number, number, number] };
}

interface TextureIndex {
  textures: TextureEntry[];
}

const INDEX_FILE = "textures/index.json";
/** Size of the procedural fallback textures (px). */
const FALLBACK_PX = 64;
/** Cells per side of the checker / grid fallback. */
const FALLBACK_CELLS = 2;
/** Grid line width as a fraction of a cell. */
const GRID_LINE = 0.08;
/** Speckles per fallback noise texture. */
const NOISE_SPECKLES = 220;
/** Deterministic noise (same picture on every load). */
const NOISE_SEED = 1234567;
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const LCG_RANGE = 2 ** 32;

/**
 * Named level materials from `data/materials.json` on top of the textures in `public/textures/index.json`
 * (phase 7). Repeating textures are scaled for UVs in world metres (`LevelBuilder` writes such UVs), clamp/decal
 * textures span the unit square. A material whose texture is missing from the index, or fails to load, gets a
 * procedural canvas texture (checker / grid / noise in palette colours).
 *
 * Every material is made by `MatteDefaults.material` (black specular): the flat low-poly look needs no highlights, and
 * point-light specular on walls reads as a torch carried by the player (FEEDBACK.md, light near walls).
 */
export class MaterialLibrary {
  readonly data: MaterialsData;
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly entries = new Map<string, TextureEntry>();
  private readonly fallbacks = new Map<string, DynamicTexture>();

  private constructor(
    private readonly scene: Scene,
    index: TextureIndex,
  ) {
    this.data = MaterialsConfig.load();
    for (const entry of index.textures) this.entries.set(entry.id, entry);
  }

  /** Loads the texture index; without it (offline file, missing tools output) every material is procedural. */
  static async load(scene: Scene): Promise<MaterialLibrary> {
    let index: TextureIndex = { textures: [] };
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${INDEX_FILE}`);
      if (response.ok) index = (await response.json()) as TextureIndex;
    } catch {
      // No index: procedural fallbacks below.
    }
    return new MaterialLibrary(scene, index);
  }

  has(id: string): boolean {
    return id in this.data.materials;
  }

  textureEntry(id: string): TextureEntry | undefined {
    return this.entries.get(id);
  }

  /** The material `id` from data/materials.json (created on first use). */
  get(id: string): StandardMaterial {
    let material = this.materials.get(id);
    if (material === undefined) {
      const def = this.data.materials[id];
      if (def === undefined) throw new Error(`MaterialLibrary: no material "${id}" in ${MaterialsConfig.file}`);
      material = this.create(id, def);
      this.materials.set(id, material);
    }
    return material;
  }

  /** A self-lit material in a palette colour (light fixtures); `intensity` above 1 reaches the bloom threshold. */
  glow(color: PaletteKey, intensity: number): StandardMaterial {
    const id = `glow:${color}:${intensity}`;
    let material = this.materials.get(id);
    if (material === undefined) {
      material = MatteDefaults.material(id, this.scene);
      material.diffuseColor = Color3.Black();
      material.emissiveColor = PaletteColor.emissive(color, intensity);
      material.disableLighting = true;
      this.materials.set(id, material);
    }
    return material;
  }

  /** All materials created so far (tests check their specular colour). */
  all(): StandardMaterial[] {
    return [...this.materials.values()];
  }

  private create(id: string, def: MaterialDef): StandardMaterial {
    const material = MatteDefaults.material(`mat:${id}`, this.scene);
    material.maxSimultaneousLights = this.data.maxLights;
    const tint = Color3.White().scale(1 - (def.tintStrength ?? 1)).add(PaletteColor.color3(def.tint).scale(def.tintStrength ?? 1));
    const texture = this.texture(id, def, () => {
      // The file is listed but did not load: same look as having no texture at all.
      const fallback = this.fallback(id, def.fallback);
      if (def.unlit === true) material.emissiveTexture = fallback;
      else material.diffuseTexture = fallback;
    });
    if (def.unlit === true) {
      material.disableLighting = true;
      material.diffuseColor = Color3.Black();
      material.emissiveColor = tint.scale(def.emissiveIntensity ?? 1);
      material.emissiveTexture = texture;
    } else {
      material.diffuseColor = tint;
      material.diffuseTexture = texture;
      if (def.emissive !== undefined) material.emissiveColor = PaletteColor.emissive(def.emissive, def.emissiveIntensity ?? 1);
    }
    if (def.alpha !== undefined && def.alpha < 1) {
      material.alpha = def.alpha;
      material.backFaceCulling = false;
    }
    if (this.entries.get(def.texture ?? "")?.tiling === "decal") {
      texture.hasAlpha = true;
      material.useAlphaFromDiffuseTexture = true;
      material.zOffset = -1;
    }
    return material;
  }

  /** The material's texture from the index, scaled for metre UVs; the procedural fallback when there is none. */
  private texture(id: string, def: MaterialDef, onError: () => void): Texture {
    const entry = def.texture === undefined ? undefined : this.entries.get(def.texture);
    if (entry === undefined) return this.fallback(id, def.fallback);
    const sampling = this.data.sampling === "nearest" ? Texture.NEAREST_NEAREST_MIPLINEAR : Texture.TRILINEAR_SAMPLINGMODE;
    const unit = entry.tiling === "clamp" || entry.tiling === "decal";
    const texture = new Texture(`${import.meta.env.BASE_URL}${entry.file}`, this.scene, { samplingMode: sampling, onError });
    if (unit) {
      texture.wrapU = Texture.CLAMP_ADDRESSMODE;
      texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    } else {
      const scale = def.uvScale ?? 1;
      texture.uScale = 1 / (entry.sizeM[0] * scale);
      texture.vScale = 1 / (entry.sizeM[1] * scale);
    }
    return texture;
  }

  private fallback(id: string, fallback: MaterialFallback): DynamicTexture {
    let texture = this.fallbacks.get(id);
    if (texture !== undefined) return texture;
    texture = new DynamicTexture(`fallback:${id}`, { width: FALLBACK_PX, height: FALLBACK_PX }, this.scene, true, Texture.NEAREST_SAMPLINGMODE);
    const ctx = texture.getContext();
    const [base, accent] = fallback.colors.map((c) => Palette.hex(c).slice(0, 7));
    const cell = FALLBACK_PX / FALLBACK_CELLS;
    ctx.fillStyle = base!;
    ctx.fillRect(0, 0, FALLBACK_PX, FALLBACK_PX);
    ctx.fillStyle = accent!;
    if (fallback.pattern === "checker") {
      for (let row = 0; row < FALLBACK_CELLS; row++) {
        for (let col = 0; col < FALLBACK_CELLS; col++) if ((row + col) % 2 === 1) ctx.fillRect(col * cell, row * cell, cell, cell);
      }
    } else if (fallback.pattern === "grid") {
      const line = Math.max(1, Math.round(cell * GRID_LINE));
      for (let i = 0; i < FALLBACK_CELLS; i++) {
        ctx.fillRect(i * cell, 0, line, FALLBACK_PX);
        ctx.fillRect(0, i * cell, FALLBACK_PX, line);
      }
    } else {
      let seed = NOISE_SEED;
      const random = (): number => {
        seed = (Math.imul(seed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
        return seed / LCG_RANGE;
      };
      for (let i = 0; i < NOISE_SPECKLES; i++) ctx.fillRect(Math.floor(random() * FALLBACK_PX), Math.floor(random() * FALLBACK_PX), 1, 1);
    }
    texture.update();
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = 1 / fallback.sizeM;
    texture.vScale = 1 / fallback.sizeM;
    this.fallbacks.set(id, texture);
    return texture;
  }
}
