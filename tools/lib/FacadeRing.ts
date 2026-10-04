// A ring of real house facades around the viewer for the skybox (FEEDBACK 2026-10-04): the rectified facades of
// tools/rectify-facades.ts laid end to end along a regular polygon of vertical planes (one unit from the viewer), so the
// dark band below the terrace roofline becomes the houses across the street and the courtyard. Planes keep the
// facades straight in perspective; the polygon corners read as house corners.
import { readFileSync } from "node:fs";
import sharp from "sharp";

const DEG = Math.PI / 180;
const FULL_TURN = 360;
const HALF_TURN = 180;
const RGBA = 4;
const BYTE = 255;

export interface FacadeRingConfig {
  /** Polygon sides (8 = octagon). */
  planes: number;
  /** Azimuth (skybox convention: 0 = side a, clockwise) of the centre of the first piece. */
  centerAzDeg: number;
  /** Elevations at a plane centre of the facade coordinates t = tTop and t = tBottom. */
  topDeg: number;
  bottomDeg: number;
  tTop: number;
  tBottom: number;
  /** The lowest `fadeBottomT` facade units fade out (the street level sinks into the dark haze). */
  fadeBottomT: number;
  /** Pieces in order (clockwise), repeated until the ring is closed. */
  sequence: { facade: string; flip?: boolean; gain?: number }[];
}

interface FacadeImage {
  w: number;
  h: number;
  data: Buffer;
  /** Plane coordinates of the image from tools/rectify-facades.json. */
  rect: [s0: number, s1: number, t0: number, t1: number];
}

interface Piece {
  image: FacadeImage;
  start: number;
  width: number;
  flip: boolean;
  gain: number;
}

export interface FacadeSample {
  /** sRGB bytes 0..255. */
  rgb: [number, number, number];
  alpha: number;
}

export class FacadeRing {
  private readonly halfPlane: number;
  private readonly perimeter: number;
  /** Ring units (one unit = polygon apothem) per facade t-unit. */
  private readonly scale: number;
  private readonly hTop: number;

  private constructor(
    private readonly config: FacadeRingConfig,
    private readonly pieces: Piece[],
    private readonly origin: number,
  ) {
    this.halfPlane = Math.tan((HALF_TURN / config.planes) * DEG);
    this.perimeter = 2 * this.halfPlane * config.planes;
    this.hTop = Math.tan(config.topDeg * DEG);
    this.scale = (this.hTop - Math.tan(config.bottomDeg * DEG)) / (config.tTop - config.tBottom);
  }

  /** Loads the facades named in `config.sequence` from `rectifyConfigPath` (their rects) and its outDir (the PNGs). */
  static async load(config: FacadeRingConfig, rectifyConfigPath: string): Promise<FacadeRing> {
    const rectify = JSON.parse(readFileSync(rectifyConfigPath, "utf8")) as { outDir: string; facades: { name: string; rect: FacadeImage["rect"] }[] };
    const images = new Map<string, FacadeImage>();
    for (const name of new Set(config.sequence.map((p) => p.facade))) {
      const spec = rectify.facades.find((f) => f.name === name);
      if (spec === undefined) throw new Error(`FacadeRing: unknown facade "${name}" (not in ${rectifyConfigPath})`);
      const { data, info } = await sharp(`${rectify.outDir}/${name}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      images.set(name, { w: info.width, h: info.height, data, rect: spec.rect });
    }
    const halfPlane = Math.tan((HALF_TURN / config.planes) * DEG);
    const perimeter = 2 * halfPlane * config.planes;
    const scale = (Math.tan(config.topDeg * DEG) - Math.tan(config.bottomDeg * DEG)) / (config.tTop - config.tBottom);
    // Lay the sequence end to end (repeating it) until the perimeter is covered; the last piece is cut by the wrap.
    const pieces: Piece[] = [];
    let at = 0;
    for (let i = 0; at < perimeter; i++) {
      const item = config.sequence[i % config.sequence.length]!;
      const image = images.get(item.facade)!;
      const width = (image.rect[1] - image.rect[0]) * scale;
      pieces.push({ image, start: at, width, flip: item.flip ?? false, gain: item.gain ?? 1 });
      at += width;
    }
    // centerAzDeg is the centre of plane 0 (ring position halfPlane); centre the first piece there.
    const origin = halfPlane - pieces[0]!.width / 2;
    return new FacadeRing(config, pieces, origin);
  }

  /** Facade colour and coverage in direction (azimuth, elevation), or null when no facade is there. */
  sample(azDeg: number, elDeg: number): FacadeSample | null {
    const { config } = this;
    const step = FULL_TURN / config.planes;
    const rel = wrap(azDeg - config.centerAzDeg);
    const plane = Math.round(rel / step);
    const phi = (rel - plane * step) * DEG;
    const ring = ringPosition(plane, Math.tan(phi), config.planes, this.halfPlane);
    const along = (((ring - this.origin) % this.perimeter) + this.perimeter) % this.perimeter;
    // Height on the plane of a ray at elevation el: distance 1 / cos(phi).
    const h = Math.tan(elDeg * DEG) / Math.cos(phi);
    const t = config.tTop - (this.hTop - h) / this.scale;
    const piece = this.pieceAt(along);
    if (piece === null) return null;
    const [s0, s1, t0, t1] = piece.image.rect;
    if (t < t0 || t > t1) return null;
    let u = (along - piece.start) / piece.width;
    if (piece.flip) u = 1 - u;
    const s = s0 + u * (s1 - s0);
    const hit = this.texel(piece, ((s - s0) / (s1 - s0)) * piece.image.w - 0.5, ((t1 - t) / (t1 - t0)) * piece.image.h - 0.5);
    const fade = Math.min(1, Math.max(0, (t - t0) / config.fadeBottomT));
    hit.alpha *= fade * fade * (3 - 2 * fade);
    return hit;
  }

  private pieceAt(along: number): Piece | null {
    for (const piece of this.pieces) if (along >= piece.start && along < piece.start + piece.width) return piece;
    return null;
  }

  private texel(piece: Piece, x: number, y: number): FacadeSample {
    const { w, h, data } = piece.image;
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, x - x0));
    const ty = Math.max(0, Math.min(1, y - y0));
    const px = (xx: number, yy: number, c: number) => data[(yy * w + xx) * RGBA + c]!;
    const mix = (c: number) => (px(x0, y0, c) * (1 - tx) + px(x1, y0, c) * tx) * (1 - ty) + (px(x0, y1, c) * (1 - tx) + px(x1, y1, c) * tx) * ty;
    const g = piece.gain;
    return { rgb: [Math.min(BYTE, mix(0) * g), Math.min(BYTE, mix(1) * g), Math.min(BYTE, mix(2) * g)], alpha: mix(3) / BYTE };
  }
}

function wrap(deg: number): number {
  return ((((deg + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN) - HALF_TURN;
}

/** Position along the polygon perimeter of offset x (tangent) on plane `plane` (plane 0 starts at ring 0). */
function ringPosition(plane: number, x: number, planes: number, halfPlane: number): number {
  return (((plane % planes) + planes) % planes) * 2 * halfPlane + halfPlane + x;
}
