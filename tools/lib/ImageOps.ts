// Pixel operations for the texture tools (phase 7). Pure functions over a float RGB(A) buffer,
// sharp only for decode, blur, resize and PNG encode. Deterministic: same input → same bytes.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import sharp, { type Sharp } from "sharp";

/** Float image, `c` interleaved channels (3 = RGB, 4 = RGBA), values 0..255. */
export interface Img {
  w: number;
  h: number;
  c: number;
  d: Float32Array;
}

export type Rect = [left: number, top: number, width: number, height: number];
export type Point = [x: number, y: number];

const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;
const BYTE_MAX = 255;

const cache = new Map<string, Img>();

export function create(w: number, h: number, c = 3): Img {
  return { w, h, c, d: new Float32Array(w * h * c) };
}

export async function load(path: string): Promise<Img> {
  const hit = cache.get(path);
  if (hit) return hit;
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const img: Img = { w: info.width, h: info.height, c: 3, d: Float32Array.from(data) };
  cache.set(path, img);
  return img;
}

function at(a: Float32Array, i: number): number {
  return a[i] ?? 0;
}

export function luma(img: Img, x: number, y: number): number {
  const i = (y * img.w + x) * img.c;
  return LUMA_R * at(img.d, i) + LUMA_G * at(img.d, i + 1) + LUMA_B * at(img.d, i + 2);
}

export function crop(img: Img, [l, t, w, h]: Rect): Img {
  if (l < 0 || t < 0 || l + w > img.w || t + h > img.h) throw new Error(`crop ${[l, t, w, h]} outside ${img.w}×${img.h}`);
  const out = create(w, h, img.c);
  for (let y = 0; y < h; y++) {
    const src = ((t + y) * img.w + l) * img.c;
    out.d.set(img.d.subarray(src, src + w * img.c), y * w * img.c);
  }
  return out;
}

/** Bilinear sample with clamped borders, writes `img.c` channels into `out` at `o`. */
export function sample(img: Img, x: number, y: number, out: Float32Array, o: number): void {
  const cx = Math.min(Math.max(x - 0.5, 0), img.w - 1);
  const cy = Math.min(Math.max(y - 0.5, 0), img.h - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, img.w - 1);
  const y1 = Math.min(y0 + 1, img.h - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  for (let k = 0; k < img.c; k++) {
    const a = at(img.d, (y0 * img.w + x0) * img.c + k);
    const b = at(img.d, (y0 * img.w + x1) * img.c + k);
    const c = at(img.d, (y1 * img.w + x0) * img.c + k);
    const d = at(img.d, (y1 * img.w + x1) * img.c + k);
    out[o + k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
}

/** Solves the 8-parameter homography mapping the unit square corners to `quad` (TL, TR, BR, BL). */
function squareToQuad(quad: [Point, Point, Point, Point]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}

/** Perspective-rectifies the quadrilateral (TL, TR, BR, BL in source px) into a w×h image. */
export function warpQuad(img: Img, quad: [Point, Point, Point, Point], w: number, h: number): Img {
  const [a, b, c, d, e, f, g, hh] = squareToQuad(quad) as [number, number, number, number, number, number, number, number];
  const out = create(w, h, img.c);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const z = g * u + hh * v + 1;
      sample(img, (a * u + b * v + c) / z, (d * u + e * v + f) / z, out.d, (y * w + x) * img.c);
    }
  }
  return out;
}

export function rotate90(img: Img, turns: number): Img {
  let cur = img;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    const out = create(cur.h, cur.w, cur.c);
    for (let y = 0; y < cur.h; y++) {
      for (let x = 0; x < cur.w; x++) {
        const src = (y * cur.w + x) * cur.c;
        const dst = (x * out.w + (out.w - 1 - y)) * cur.c;
        for (let k = 0; k < cur.c; k++) out.d[dst + k] = at(cur.d, src + k);
      }
    }
    cur = out;
  }
  return cur;
}

export function toBytes(img: Img): Buffer {
  const b = Buffer.alloc(img.d.length);
  for (let i = 0; i < img.d.length; i++) b[i] = Math.min(BYTE_MAX, Math.max(0, Math.round(at(img.d, i))));
  return b;
}

function sharpOf(img: Img): Sharp {
  return sharp(toBytes(img), { raw: { width: img.w, height: img.h, channels: img.c as 3 | 4 } });
}

async function fromSharp(s: Sharp, channels: number): Promise<Img> {
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== channels) throw new Error(`expected ${channels} channels, got ${info.channels}`);
  return { w: info.width, h: info.height, c: info.channels, d: Float32Array.from(data) };
}

/**
 * Removes baked low-frequency lighting: each pixel is scaled by mean luma / blurred luma,
 * so hue and fine detail stay and gradients, glare and vignetting flatten out.
 */
export async function flatten(img: Img, sigmaPx: number, strength: number): Promise<Img> {
  const lum = create(img.w, img.h, 3);
  let sum = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const l = luma(img, x, y);
      sum += l;
      const i = (y * img.w + x) * 3;
      lum.d[i] = l;
      lum.d[i + 1] = l;
      lum.d[i + 2] = l;
    }
  }
  const mean = sum / (img.w * img.h);
  // Blur with mirrored borders so the edges do not darken.
  const pad = Math.ceil(sigmaPx * 3);
  // (sharp runs extract before extend inside one pipeline, so the padded blur is a separate pass.)
  const padded = await fromSharp(sharpOf(lum).extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: "mirror" }), 3);
  const blurred = crop(await fromSharp(sharpOf(padded).blur(sigmaPx), 3), [pad, pad, img.w, img.h]);
  const out = create(img.w, img.h, img.c);
  for (let p = 0; p < img.w * img.h; p++) {
    const ratio = mean / Math.max(1, at(blurred.d, p * 3));
    const gain = 1 + (ratio - 1) * strength;
    for (let k = 0; k < img.c; k++) out.d[p * img.c + k] = at(img.d, p * img.c + k) * (k < 3 ? gain : 1);
  }
  return out;
}

/** Brightness/contrast/saturation about the image mean (contrast) and luma (saturation). */
export function adjust(img: Img, brightness: number, contrast: number, saturation: number): Img {
  let sum = 0;
  const n = img.w * img.h;
  for (let p = 0; p < n; p++) sum += LUMA_R * at(img.d, p * img.c) + LUMA_G * at(img.d, p * img.c + 1) + LUMA_B * at(img.d, p * img.c + 2);
  const mean = sum / n;
  const out = create(img.w, img.h, img.c);
  out.d.set(img.d);
  for (let p = 0; p < n; p++) {
    const i = p * img.c;
    const l = LUMA_R * at(img.d, i) + LUMA_G * at(img.d, i + 1) + LUMA_B * at(img.d, i + 2);
    for (let k = 0; k < 3; k++) {
      const v = l + (at(img.d, i + k) - l) * saturation;
      out.d[i + k] = ((v - mean) * contrast + mean) * brightness;
    }
  }
  return out;
}

/**
 * Makes a tile seamless by cross-fading: the source is (1 + `blend`) × the output size and the
 * overhang on the right/bottom is faded into the left/top edge, so out(W-1) → out(0) continues the photo.
 */
export function seamless(img: Img, blend: number, axes: "xy" | "x" | "y"): Img {
  // The sample is (1 + blend) × the output, so the faded overhang equals blend × output.
  const mx = axes.includes("x") ? Math.round((img.w * blend) / (1 + blend)) : 0;
  const my = axes.includes("y") ? Math.round((img.h * blend) / (1 + blend)) : 0;
  const w = img.w - mx;
  const h = img.h - my;
  const tmp = create(w, img.h, img.c);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < w; x++) {
      const t = x < mx ? smooth((x + 0.5) / mx) : 1;
      for (let k = 0; k < img.c; k++) {
        const base = at(img.d, (y * img.w + x) * img.c + k);
        const wrap = x < mx ? at(img.d, (y * img.w + x + w) * img.c + k) : base;
        tmp.d[(y * w + x) * img.c + k] = wrap * (1 - t) + base * t;
      }
    }
  }
  const out = create(w, h, img.c);
  for (let y = 0; y < h; y++) {
    const t = y < my ? smooth((y + 0.5) / my) : 1;
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < img.c; k++) {
        const base = at(tmp.d, (y * w + x) * img.c + k);
        const wrap = y < my ? at(tmp.d, ((y + h) * w + x) * img.c + k) : base;
        out.d[(y * w + x) * img.c + k] = wrap * (1 - t) + base * t;
      }
    }
  }
  return out;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Autocorrelation period (px, sub-pixel) of the luma along one axis inside `rect`. */
export function estimatePeriod(img: Img, rect: Rect, axis: "x" | "y", [min, max]: [number, number]): number {
  const [l, t, w, h] = rect;
  const g = new Float64Array(w * h);
  let mean = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mean += g[y * w + x] = luma(img, l + x, t + y);
  mean /= w * h;
  for (let i = 0; i < g.length; i++) g[i] = (g[i] ?? 0) - mean;
  const corr = (d: number): number => {
    let s = 0;
    let n = 0;
    const dx = axis === "x" ? d : 0;
    const dy = axis === "y" ? d : 0;
    for (let y = 0; y + dy < h; y++) {
      for (let x = 0; x + dx < w; x++) {
        s += (g[y * w + x] ?? 0) * (g[(y + dy) * w + x + dx] ?? 0);
        n++;
      }
    }
    return s / n;
  };
  let best = min;
  let bestV = -Infinity;
  const values = new Map<number, number>();
  for (let d = min - 1; d <= max + 1; d++) values.set(d, corr(d));
  for (let d = min; d <= max; d++) {
    const v = values.get(d) ?? -Infinity;
    if (v > bestV) {
      bestV = v;
      best = d;
    }
  }
  const a = values.get(best - 1) ?? bestV;
  const c = values.get(best + 1) ?? bestV;
  const den = a - 2 * bestV + c;
  return den === 0 ? best : best + (0.5 * (a - c)) / den;
}

/**
 * Folds a periodic pattern: every pixel of one lattice cell (px × py source px, rendered at cellPx)
 * is the per-channel median over all whole periods inside `rect`. Chairs, glare and stitching
 * patches drop out, the tile is exactly periodic and keeps the photographed colours.
 */
export function foldPeriodic(img: Img, rect: Rect, px: number, py: number, cellPx: number): Img {
  const [l, t, w, h] = rect;
  const nx = Math.floor(w / px);
  const ny = Math.floor(h / py);
  const out = create(cellPx, cellPx, 3);
  const tmp = new Float32Array(3);
  const ch: Float32Array[] = [new Float32Array(nx * ny), new Float32Array(nx * ny), new Float32Array(nx * ny)];
  for (let j = 0; j < cellPx; j++) {
    for (let i = 0; i < cellPx; i++) {
      const u = ((i + 0.5) / cellPx) * px;
      const v = ((j + 0.5) / cellPx) * py;
      let n = 0;
      for (let b = 0; b < ny; b++) {
        for (let a = 0; a < nx; a++) {
          sample(img, l + u + a * px, t + v + b * py, tmp, 0);
          for (let k = 0; k < 3; k++) (ch[k] as Float32Array)[n] = tmp[k] ?? 0;
          n++;
        }
      }
      for (let k = 0; k < 3; k++) {
        const s = (ch[k] as Float32Array).subarray(0, n).sort();
        out.d[(j * cellPx + i) * 3 + k] = at(s, n >> 1);
      }
    }
  }
  return out;
}

/**
 * Splits pixels into dark/light by Otsu's luma threshold and pulls each towards its class median colour:
 * crisp tile edges, photo colours, `keep` (0..1) of the original variation inside each class.
 */
export function twoTone(img: Img, keep: number): { img: Img; darkMask: Uint8Array; dark: [number, number, number]; light: [number, number, number] } {
  const n = img.w * img.h;
  const lum = new Float32Array(n);
  const hist = new Float64Array(BYTE_MAX + 1);
  for (let p = 0; p < n; p++) {
    const l = LUMA_R * at(img.d, p * img.c) + LUMA_G * at(img.d, p * img.c + 1) + LUMA_B * at(img.d, p * img.c + 2);
    lum[p] = l;
    const bin = Math.min(BYTE_MAX, Math.max(0, Math.round(l)));
    hist[bin] = (hist[bin] ?? 0) + 1;
  }
  let total = 0;
  for (let i = 0; i <= BYTE_MAX; i++) total += i * (hist[i] ?? 0);
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let threshold = BYTE_MAX >> 1;
  for (let i = 0; i <= BYTE_MAX; i++) {
    wB += hist[i] ?? 0;
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += i * (hist[i] ?? 0);
    const between = wB * wF * (sumB / wB - (total - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = i;
    }
  }
  const darkMask = new Uint8Array(n);
  const lightMask = new Uint8Array(n);
  for (let p = 0; p < n; p++) (at(lum, p) <= threshold ? darkMask : lightMask)[p] = 1;
  const dark = medianColour(img, darkMask);
  const light = medianColour(img, lightMask);
  const out = create(img.w, img.h, img.c);
  for (let p = 0; p < n; p++) {
    const ref = darkMask[p] ? dark : light;
    for (let k = 0; k < 3; k++) out.d[p * img.c + k] = (ref[k] ?? 0) + (at(img.d, p * img.c + k) - (ref[k] ?? 0)) * keep;
  }
  return { img: out, darkMask, dark, light };
}

const FIT_STEPS = 64;
const FIT_GRID = 64;
const SUPERSAMPLE = 4;
/** Largest photo-grain offset (0..255) kept on an idealised checker tile. */
const MAX_DETAIL = 10;

/**
 * Replaces the geometry of one folded lattice cell of a 45° checkerboard by the ideal pattern
 * parity(⌊u+v+a⌋ + ⌊u−v+b⌋) (u, v = cell coords in periods), with the phase (a, b) fitted to the
 * photo's dark/light mask. Colours stay the photo's class medians plus `keep` of its variation.
 */
export function fitDiamondChecker(img: Img, keep: number): { img: Img; phase: [number, number]; agreement: number } {
  const { img: toned, darkMask, dark, light } = twoTone(img, keep);
  const darkAt = (u: number, v: number, a: number, b: number): boolean => ((Math.floor(u + v + a) + Math.floor(u - v + b)) & 1) === 0;
  let best: [number, number] = [0, 0];
  let bestScore = -1;
  for (let ia = 0; ia < 2 * FIT_STEPS; ia++) {
    for (let ib = 0; ib < FIT_STEPS; ib++) {
      const a = ia / FIT_STEPS;
      const b = ib / FIT_STEPS;
      let score = 0;
      for (let j = 0; j < FIT_GRID; j++) {
        for (let i = 0; i < FIT_GRID; i++) {
          const x = Math.floor(((i + 0.5) / FIT_GRID) * img.w);
          const y = Math.floor(((j + 0.5) / FIT_GRID) * img.h);
          if (darkAt((i + 0.5) / FIT_GRID, (j + 0.5) / FIT_GRID, a, b) === (darkMask[y * img.w + x] === 1)) score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = [a, b];
      }
    }
  }
  const [a, b] = best;
  const out = create(img.w, img.h, img.c);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      let cov = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          if (darkAt((x + (sx + 0.5) / SUPERSAMPLE) / img.w, (y + (sy + 0.5) / SUPERSAMPLE) / img.h, a, b)) cov++;
        }
      }
      cov /= SUPERSAMPLE * SUPERSAMPLE;
      const p = y * img.w + x;
      const own = darkMask[p] ? dark : light;
      // Photo grain only inside tiles where photo and ideal agree; blurred photo edges add nothing.
      const agrees = (cov === 1 && darkMask[p] === 1) || (cov === 0 && darkMask[p] === 0);
      for (let k = 0; k < 3; k++) {
        const raw = agrees ? at(toned.d, p * img.c + k) - (own[k] ?? 0) : 0;
        const detail = Math.max(-MAX_DETAIL, Math.min(MAX_DETAIL, raw));
        out.d[p * img.c + k] = (dark[k] ?? 0) * cov + (light[k] ?? 0) * (1 - cov) + detail;
      }
    }
  }
  return { img: out, phase: best, agreement: bestScore / (FIT_GRID * FIT_GRID) };
}

/** Scales each channel so the image mean matches `target` (keeps the grain, changes the colour). */
export function recolour(img: Img, target: [number, number, number]): Img {
  const n = img.w * img.h;
  const mean = [0, 0, 0];
  for (let p = 0; p < n; p++) for (let k = 0; k < 3; k++) mean[k] = (mean[k] ?? 0) + at(img.d, p * img.c + k) / n;
  const out = create(img.w, img.h, img.c);
  out.d.set(img.d);
  for (let p = 0; p < n; p++) for (let k = 0; k < 3; k++) out.d[p * img.c + k] = at(img.d, p * img.c + k) * ((target[k] ?? 0) / Math.max(1, mean[k] ?? 1));
  return out;
}

export function tile(img: Img, rx: number, ry: number): Img {
  const out = create(img.w * rx, img.h * ry, img.c);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const src = ((y % img.h) * img.w + (x % img.w)) * img.c;
      const dst = (y * out.w + x) * img.c;
      for (let k = 0; k < img.c; k++) out.d[dst + k] = at(img.d, src + k);
    }
  }
  return out;
}

/**
 * Resizes to w×h. Repeating textures are resampled from a 3×3 tiling so the filter wraps around
 * the edges (no seam). `pixelate` > 1 renders at w/pixelate and enlarges with nearest neighbour.
 */
export async function resize(img: Img, w: number, h: number, wrap: boolean, pixelate: number): Promise<Img> {
  const sw = Math.max(1, Math.round(w / pixelate));
  const sh = Math.max(1, Math.round(h / pixelate));
  let small: Img;
  if (wrap) {
    const big = await fromSharp(sharpOf(tile(img, 3, 3)).resize(sw * 3, sh * 3, { fit: "fill", kernel: "lanczos3" }), img.c);
    small = crop(big, [sw, sh, sw, sh]);
  } else {
    small = await fromSharp(sharpOf(img).resize(sw, sh, { fit: "fill", kernel: "lanczos3" }), img.c);
  }
  if (sw === w && sh === h) return small;
  return fromSharp(sharpOf(small).resize(w, h, { fit: "fill", kernel: "nearest" }), img.c);
}

/** Encodes a palette PNG (libimagequant, no dithering = posterized) and writes it only if the bytes differ. */
export async function savePng(img: Img, path: string, colours: number): Promise<boolean> {
  const buf = await sharpOf(img).png({ palette: true, colours, dither: 0, effort: 10, compressionLevel: 9 }).toBuffer();
  return writeIfChanged(path, buf);
}

export function writeIfChanged(path: string, buf: Buffer): boolean {
  if (existsSync(path) && readFileSync(path).equals(buf)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  return true;
}

/** Median colour of the pixels selected by `mask` (RGB). */
export function medianColour(img: Img, mask: Uint8Array): [number, number, number] {
  const ch: number[][] = [[], [], []];
  for (let p = 0; p < img.w * img.h; p++) {
    if (!mask[p]) continue;
    for (let k = 0; k < 3; k++) (ch[k] as number[]).push(at(img.d, p * img.c + k));
  }
  return ch.map((a) => {
    a.sort((x, y) => x - y);
    return Math.round(a[a.length >> 1] ?? 0);
  }) as [number, number, number];
}

/** RGB 0..255 → HSV with hue in degrees, s and v in 0..1. */
export function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, max === 0 ? 0 : d / max, max / BYTE_MAX];
}
