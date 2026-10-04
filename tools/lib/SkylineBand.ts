// The painted city below the terrace parapet (tools/outpaint-skyline.ts): an equirectangular band, azimuth 0–360° ×
// elevation elTop…elBottom, sRGB with coverage in alpha. tools/prague-skybox.ts puts it below the parapet curve.
import { readFileSync } from "node:fs";
import sharp from "sharp";

const RGBA = 4;
const BYTE = 255;
const FULL_TURN = 360;

export interface SkylineSample {
  /** sRGB bytes 0..255. */
  rgb: [number, number, number];
  alpha: number;
}

export class SkylineBand {
  private constructor(
    private readonly data: Buffer,
    private readonly w: number,
    private readonly h: number,
    private readonly pxPerDeg: number,
    private readonly elTopDeg: number,
  ) {}

  /** Loads the band named by the outpaint config (`out` and `band`). */
  static async load(outpaintConfigPath: string): Promise<SkylineBand> {
    const cfg = JSON.parse(readFileSync(outpaintConfigPath, "utf8")) as { out: string; band: { pxPerDeg: number; elTopDeg: number } };
    const { data, info } = await sharp(cfg.out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return new SkylineBand(data, info.width, info.height, cfg.band.pxPerDeg, cfg.band.elTopDeg);
  }

  /** Bilinear colour and coverage in direction (azimuth, elevation), wrapping in azimuth; null outside the band. */
  sample(azDeg: number, elDeg: number): SkylineSample | null {
    const fx = ((((azDeg % FULL_TURN) + FULL_TURN) % FULL_TURN) * this.pxPerDeg) - 0.5;
    const fy = (this.elTopDeg - elDeg) * this.pxPerDeg - 0.5;
    if (fy < 0 || fy > this.h - 1) return null;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const xa = ((x0 % this.w) + this.w) % this.w;
    const xb = (xa + 1) % this.w;
    const y1 = Math.min(this.h - 1, y0 + 1);
    const px = (x: number, y: number, c: number) => this.data[(y * this.w + x) * RGBA + c]!;
    const mix = (c: number) => (px(xa, y0, c) * (1 - tx) + px(xb, y0, c) * tx) * (1 - ty) + (px(xa, y1, c) * (1 - tx) + px(xb, y1, c) * tx) * ty;
    const alpha = mix(3) / BYTE;
    if (alpha <= 0) return null;
    return { rgb: [mix(0), mix(1), mix(2)], alpha };
  }
}
