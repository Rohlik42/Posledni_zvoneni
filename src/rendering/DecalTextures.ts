import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { DetailsConfig, type DetailsData } from "../level/DetailsConfig";
import { Palette, type PaletteKey } from "../utils/Palette";
import { Random } from "../utils/Random";
import { MatteDefaults } from "./MatteDefaults";
import { PaletteColor } from "./PaletteColor";

/** Material ids of decals: `decal:<kind>:<variant>` (kinds below); the sign variant is its label `30|UČEBNA`. */
export const DECAL_PREFIX = "decal:";
const KINDS = ["scorch", "stain", "hole", "sign", "graffiti"] as const;
type DecalKind = (typeof KINDS)[number];
const SIGN_SEPARATOR = "|";
const FONT_SIZE_TOKEN = "{px}";
/** Sign plates are drawn wider than tall like the quads they go on (size from details.json → signs.size). */
const SIGN_ASPECT = 0.6;
const GRAFFITI_ASPECT = 0.5;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
/** Blobs per scorch / stain, and how far from the centre they wander (share of the canvas). */
const BLOBS = 26;
const BLOB_SPREAD = 0.24;
const STAIN_RINGS = 3;
const HOLE_POINTS = 22;
const DIRT_SPECKS = 160;
const DRIPS_PER_LINE = 6;
/** Neon stencils glow a little in the dark (share of their colour as emissive). */
const STENCIL_GLOW = 0.35;
/** Font loading may hang offline; the decals are drawn with the fallback font after this. */
const FONT_WAIT_MS = 1500;
const VARIANT_SEED = 7919;

/**
 * Procedural detail textures (phase 19, DESIGN §13 „detailní textury procedurální“): scorch marks, water stains, the hole
 * of a collapsed ceiling, door plates with room numbers and graffiti (Neuralith Dynamics stencils, students' spray),
 * drawn once into canvases from `data/details.json → textures` and colours of the palette. `LevelBuilder` resolves
 * `decal:` material ids of `DetailGenerator`'s quads here. Decals are alpha-blended, matte and lit by their room.
 */
export class DecalTextures {
  private readonly data: DetailsData;
  private readonly materials = new Map<string, StandardMaterial>();

  constructor(
    private readonly scene: Scene,
    private readonly maxLights: number,
    data?: DetailsData,
  ) {
    this.data = data ?? DetailsConfig.load();
  }

  /** Waits (bounded) until the bundled fonts the plates and graffiti use are loaded, so the canvases do not fall back. */
  static async fontsReady(data: DetailsData = DetailsConfig.load()): Promise<void> {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (fonts === undefined) return;
    const specs = [data.textures.sign.font, data.textures.sign.smallFont, data.textures.graffitiFont].map((f) => f.replace(FONT_SIZE_TOKEN, "32"));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT_MS));
    try {
      await Promise.race([Promise.all(specs.map((spec) => fonts.load(spec))).then(() => undefined), timeout]);
    } catch {
      // A font that fails to load leaves the canvas fallback (Arial).
    }
  }

  static isDecal(id: string): boolean {
    return id.startsWith(DECAL_PREFIX);
  }

  /** The material of a `decal:<kind>:<variant>` id (created on first use). */
  material(id: string): StandardMaterial {
    let material = this.materials.get(id);
    if (material !== undefined) return material;
    const [kind, ...rest] = id.slice(DECAL_PREFIX.length).split(":");
    const variant = rest.join(":");
    if (!(KINDS as readonly string[]).includes(kind ?? "")) throw new Error(`DecalTextures: unknown decal "${id}"`);
    const texture = this.draw(kind as DecalKind, variant, id);
    material = MatteDefaults.material(`mat:${id}`, this.scene);
    material.maxSimultaneousLights = this.maxLights;
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.backFaceCulling = false;
    if (kind === "graffiti") {
      const g = this.data.textures.graffiti[Number(variant)];
      if (g?.style === "stencil") {
        material.emissiveTexture = texture;
        material.emissiveColor = Color3.White().scale(STENCIL_GLOW);
      }
    }
    this.materials.set(id, material);
    return material;
  }

  /** Every decal material made so far (tests, specular check). */
  all(): StandardMaterial[] {
    return [...this.materials.values()];
  }

  private draw(kind: DecalKind, variant: string, id: string): DynamicTexture {
    const px = this.data.textures.px;
    const height = kind === "sign" ? Math.round(px * SIGN_ASPECT) : kind === "graffiti" ? Math.round(px * 2 * GRAFFITI_ASPECT) : px;
    const width = kind === "graffiti" ? px * 2 : px;
    const texture = new DynamicTexture(`decal:${id}`, { width, height }, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    texture.hasAlpha = true;
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, width, height);
    const random = new Random(VARIANT_SEED + DecalTextures.hash(id));
    switch (kind) {
      case "scorch":
        this.scorch(ctx, px, random);
        break;
      case "stain":
        this.stain(ctx, px, random);
        break;
      case "hole":
        this.hole(ctx, px, random);
        break;
      case "sign":
        this.sign(ctx, width, height, variant, random);
        break;
      case "graffiti":
        this.graffiti(ctx, width, height, Number(variant), random);
        break;
    }
    texture.update();
    return texture;
  }

  private scorch(ctx: CanvasRenderingContext2D, px: number, random: Random): void {
    const d = this.data.textures.scorch;
    // Rust-brown rim under the black soot, both made of soft overlapping blobs.
    this.blobs(ctx, px, random, d.rim, d.alpha * 0.35, 0.5);
    this.blobs(ctx, px, random, d.color, d.alpha, 0.36);
  }

  private stain(ctx: CanvasRenderingContext2D, px: number, random: Random): void {
    const d = this.data.textures.stain;
    this.blobs(ctx, px, random, d.color, d.alpha * 0.6, 0.34);
    // Tide marks of dried water.
    const rgb = DecalTextures.rgb(d.color);
    for (let i = 0; i < STAIN_RINGS; i++) {
      ctx.strokeStyle = `rgba(${rgb},${d.alpha})`;
      ctx.lineWidth = px * 0.012;
      ctx.beginPath();
      const r = px * (0.18 + i * 0.07) * random.range(0.9, 1.1);
      for (let a = 0; a <= FULL_TURN + 1e-6; a += FULL_TURN / 24) {
        const wobble = r * random.range(0.85, 1.12);
        const x = px * HALF + Math.cos(a) * wobble;
        const y = px * HALF + Math.sin(a) * wobble;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  private hole(ctx: CanvasRenderingContext2D, px: number, random: Random): void {
    const d = this.data.textures.hole;
    const ring = (radius: number, color: PaletteKey, alpha: number): void => {
      ctx.fillStyle = `rgba(${DecalTextures.rgb(color)},${alpha})`;
      ctx.beginPath();
      for (let i = 0; i < HOLE_POINTS; i++) {
        const a = (i / HOLE_POINTS) * FULL_TURN;
        const r = px * radius * random.range(0.62, 1);
        const x = px * HALF + Math.cos(a) * r;
        const y = px * HALF + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    };
    ring(0.49, d.rim, d.alpha * 0.8);
    ring(0.4, d.color, d.alpha);
  }

  private sign(ctx: CanvasRenderingContext2D, width: number, height: number, label: string, random: Random): void {
    const d = this.data.textures.sign;
    const [big = "", small = ""] = label.split(SIGN_SEPARATOR);
    const border = Math.round(height * 0.07);
    ctx.fillStyle = Palette.hex(d.border);
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = Palette.hex(d.plate);
    ctx.fillRect(border, border, width - 2 * border, height - 2 * border);
    ctx.fillStyle = Palette.hex(d.text);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const bigPx = DecalTextures.fit(ctx, big, d.font, height * (small === "" ? 0.62 : 0.5), width * 0.82);
    ctx.font = d.font.replace(FONT_SIZE_TOKEN, String(bigPx));
    ctx.fillText(big, width * HALF, height * (small === "" ? 0.52 : 0.4));
    if (small !== "") {
      const smallPx = DecalTextures.fit(ctx, small, d.smallFont, height * 0.17, width * 0.84);
      ctx.font = d.smallFont.replace(FONT_SIZE_TOKEN, String(smallPx));
      ctx.fillText(small, width * HALF, height * 0.76);
    }
    // Soot and dust on the plate.
    ctx.fillStyle = `rgba(${DecalTextures.rgb("base.soot")},${d.dirt})`;
    for (let i = 0; i < DIRT_SPECKS; i++) {
      const s = random.range(1, 4);
      ctx.fillRect(random.next() * width, random.next() * height, s, s);
    }
  }

  private graffiti(ctx: CanvasRenderingContext2D, width: number, height: number, index: number, random: Random): void {
    const g = this.data.textures.graffiti[index];
    if (g === undefined) return;
    const color = Palette.hex(g.color);
    const rgb = DecalTextures.rgb(g.color);
    const lines = g.lines;
    const rows = lines.length + ((g.small ?? "") === "" ? 0 : HALF);
    const lineHeight = (height * 0.86) / rows;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((line, i) => {
      const fontPx = DecalTextures.fit(ctx, line, this.data.textures.graffitiFont, lineHeight * 0.92, width * 0.92);
      ctx.font = this.data.textures.graffitiFont.replace(FONT_SIZE_TOKEN, String(fontPx));
      const y = height * 0.07 + lineHeight * (i + HALF);
      const jitter = g.style === "spray" ? random.range(-0.04, 0.04) : 0;
      ctx.save();
      ctx.translate(width * HALF, y);
      ctx.rotate(jitter);
      if (g.style === "spray") {
        // Soft overspray halo, then the paint, then drips running down.
        ctx.shadowColor = `rgba(${rgb},0.7)`;
        ctx.shadowBlur = fontPx * 0.18;
      }
      ctx.fillStyle = color;
      ctx.fillText(line, 0, 0);
      ctx.restore();
      if (g.style === "spray") {
        const span = ctx.measureText(line).width;
        ctx.fillStyle = `rgba(${rgb},0.85)`;
        for (let k = 0; k < DRIPS_PER_LINE; k++) {
          const x = width * HALF + random.range(-HALF, HALF) * span;
          ctx.fillRect(x, y + fontPx * 0.3, random.range(1.5, 3.5), random.range(0.1, 0.45) * fontPx);
        }
      } else {
        // Stencil bridges: thin gaps cut through the letters.
        ctx.clearRect(0, y - fontPx * 0.04, width, Math.max(1, fontPx * 0.05));
      }
    });
    if (g.small !== undefined && g.small !== "") {
      const fontPx = DecalTextures.fit(ctx, g.small, this.data.textures.graffitiFont, lineHeight * 0.42, width * 0.8);
      ctx.font = this.data.textures.graffitiFont.replace(FONT_SIZE_TOKEN, String(fontPx));
      ctx.fillStyle = color;
      ctx.fillText(g.small, width * HALF, height * 0.07 + lineHeight * (lines.length + 0.3));
    }
  }

  /** Soft blobs scattered round the centre, each a radial gradient of `color`. */
  private blobs(ctx: CanvasRenderingContext2D, px: number, random: Random, color: PaletteKey, alpha: number, radius: number): void {
    const rgb = DecalTextures.rgb(color);
    for (let i = 0; i < BLOBS; i++) {
      const a = random.next() * FULL_TURN;
      const out = random.next() * px * BLOB_SPREAD;
      const x = px * HALF + Math.cos(a) * out;
      const y = px * HALF + Math.sin(a) * out;
      const r = px * radius * random.range(0.35, 0.7);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, `rgba(${rgb},${alpha * 0.45})`);
      gradient.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, px, px);
    }
  }

  /** Largest font size (px) at which `text` fits `maxWidth`, at most `maxPx`. */
  private static fit(ctx: CanvasRenderingContext2D, text: string, font: string, maxPx: number, maxWidth: number): number {
    let size = Math.floor(maxPx);
    ctx.font = font.replace(FONT_SIZE_TOKEN, String(size));
    const width = ctx.measureText(text).width;
    if (width > maxWidth && width > 0) size = Math.floor((size * maxWidth) / width);
    return Math.max(1, size);
  }

  private static rgb(key: PaletteKey): string {
    const c = PaletteColor.color3(key);
    return `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  }

  private static hash(text: string): number {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0;
    return h;
  }
}
