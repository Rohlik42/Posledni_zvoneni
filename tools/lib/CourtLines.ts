// Extracts painted court lines from an orthographic floor-plan crop and redraws them as a clean RGBA decal.
// Lines are found by projection: a column (row) whose pixels of one colour class add up to a long run is a
// vertical (horizontal) line; its extent is the union of runs along it with small gaps bridged.
import { create, hsv, medianColour, type Img } from "./ImageOps";

export interface LineClass {
  name: string;
  hue: [number, number];
  minSat: number;
  minVal: number;
  maxVal: number;
}

export interface CourtLineParams {
  classes: LineClass[];
  pxPerM: number;
  lineWidthM: number;
  minLenM: number;
  gapM: number;
  snapM: number;
  /** Minimum share of a column/row covered by the class within the line's extent to accept it. */
  minFill: number;
  /** Ignore pixels this close to the crop border (left, top, right, bottom px): walls and benches around the court. */
  maskInsetPx: [number, number, number, number];
}

export interface Segment {
  cls: string;
  axis: "v" | "h";
  /** Position across the line (px in the crop). */
  at: number;
  from: number;
  to: number;
}

function classify(img: Img, cls: LineClass, [il, it, ir, ib]: [number, number, number, number]): Uint8Array {
  const mask = new Uint8Array(img.w * img.h);
  for (let p = 0; p < img.w * img.h; p++) {
    const x = p % img.w;
    const y = Math.floor(p / img.w);
    if (x < il || y < it || x >= img.w - ir || y >= img.h - ib) continue;
    const [h, s, v] = hsv(img.d[p * 3] ?? 0, img.d[p * 3 + 1] ?? 0, img.d[p * 3 + 2] ?? 0);
    if (h >= cls.hue[0] && h <= cls.hue[1] && s >= cls.minSat && v >= cls.minVal && v <= cls.maxVal) mask[p] = 1;
  }
  return mask;
}

function runs(present: (i: number) => boolean, n: number, gap: number, minLen: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (!present(i)) continue;
    if (start >= 0 && i - last > gap) {
      if (last - start >= minLen) out.push([start, last]);
      start = i;
    } else if (start < 0) start = i;
    last = i;
  }
  if (start >= 0 && last - start >= minLen) out.push([start, last]);
  return out;
}

function detect(mask: Uint8Array, w: number, h: number, axis: "v" | "h", p: CourtLineParams, cls: string): Segment[] {
  const across = axis === "v" ? w : h;
  const along = axis === "v" ? h : w;
  const get = (a: number, b: number): number => (axis === "v" ? (mask[b * w + a] ?? 0) : (mask[a * w + b] ?? 0));
  const minLen = p.minLenM * p.pxPerM;
  const gap = p.gapM * p.pxPerM;
  const count = new Float64Array(across);
  for (let a = 0; a < across; a++) for (let b = 0; b < along; b++) count[a] = (count[a] ?? 0) + get(a, b);
  // Candidate positions: local clusters of columns whose count reaches the minimum line length.
  const half = Math.ceil((p.lineWidthM * p.pxPerM) / 2) + 1;
  const segs: Segment[] = [];
  let a = 0;
  while (a < across) {
    if ((count[a] ?? 0) < minLen * p.minFill) {
      a++;
      continue;
    }
    let end = a;
    let sum = 0;
    let wsum = 0;
    while (end < across && (count[end] ?? 0) >= minLen * p.minFill) {
      sum += (count[end] ?? 0) * end;
      wsum += count[end] ?? 0;
      end++;
    }
    const centre = sum / wsum;
    const lo = Math.max(0, Math.floor(centre) - half);
    const hi = Math.min(across - 1, Math.ceil(centre) + half);
    const present = (b: number): boolean => {
      for (let k = lo; k <= hi; k++) if (get(k, b)) return true;
      return false;
    };
    for (const [from, to] of runs(present, along, gap, minLen)) {
      let filled = 0;
      for (let b = from; b <= to; b++) if (present(b)) filled++;
      if (filled / (to - from + 1) >= p.minFill) segs.push({ cls, axis, at: centre, from, to });
    }
    a = end;
  }
  return segs;
}

/** Snaps segment ends to perpendicular lines nearby and to the crop border, so corners close cleanly. */
function snap(segs: Segment[], p: CourtLineParams, w: number, h: number): void {
  const tol = p.snapM * p.pxPerM;
  for (const s of segs) {
    const perps = segs.filter((o) => o.axis !== s.axis).map((o) => o.at);
    for (const key of ["from", "to"] as const) {
      let best = s[key];
      let bestD = tol;
      for (const at of perps) {
        const d = Math.abs(at - s[key]);
        if (d < bestD) {
          bestD = d;
          best = at;
        }
      }
      s[key] = best;
    }
    const along = s.axis === "v" ? h : w;
    s.from = Math.max(0, s.from);
    s.to = Math.min(along, s.to);
  }
}

export interface CourtLinesResult {
  decal: Img;
  segments: Segment[];
  colours: Record<string, [number, number, number]>;
}

/** Returns an RGBA decal of size outW×outH covering the whole crop. */
export function extractCourtLines(img: Img, p: CourtLineParams, outW: number, outH: number): CourtLinesResult {
  const segments: Segment[] = [];
  const colours: Record<string, [number, number, number]> = {};
  for (const cls of p.classes) {
    const mask = classify(img, cls, p.maskInsetPx);
    colours[cls.name] = medianColour(img, mask);
    segments.push(...detect(mask, img.w, img.h, "v", p, cls.name), ...detect(mask, img.w, img.h, "h", p, cls.name));
  }
  snap(segments, p, img.w, img.h);
  const decal = create(outW, outH, 4);
  const sx = outW / img.w;
  const sy = outH / img.h;
  const halfW = (p.lineWidthM * p.pxPerM) / 2;
  for (const s of segments) {
    const c = colours[s.cls] ?? [255, 255, 255];
    const [x0, x1, y0, y1] =
      s.axis === "v" ? [s.at - halfW, s.at + halfW, s.from - halfW, s.to + halfW] : [s.from - halfW, s.to + halfW, s.at - halfW, s.at + halfW];
    // Coverage-weighted rasterisation keeps thin lines from aliasing at decal resolution.
    for (let y = Math.max(0, Math.floor(y0 * sy)); y < Math.min(outH, Math.ceil(y1 * sy)); y++) {
      const cy = Math.min(y + 1, y1 * sy) - Math.max(y, y0 * sy);
      for (let x = Math.max(0, Math.floor(x0 * sx)); x < Math.min(outW, Math.ceil(x1 * sx)); x++) {
        const cx = Math.min(x + 1, x1 * sx) - Math.max(x, x0 * sx);
        const cov = Math.max(0, Math.min(1, cx) * Math.min(1, cy));
        const i = (y * outW + x) * 4;
        const prev = decal.d[i + 3] ?? 0;
        const alpha = Math.max(prev, cov * 255);
        if (alpha > prev) {
          decal.d[i] = c[0];
          decal.d[i + 1] = c[1];
          decal.d[i + 2] = c[2];
          decal.d[i + 3] = alpha;
        }
      }
    }
  }
  return { decal, segments, colours };
}
