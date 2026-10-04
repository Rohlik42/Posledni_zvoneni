// House facades for the skybox (FEEDBACK 2026-10-04: fill the dark band below the roofline with real facades).
// Each facade is a flat plane photographed almost head-on by a Matterport panorama; sampling the cube map on a plane one
// unit in front of a side face rectifies it, and the part above the face continues on the up face, so the whole house
// up to the gables comes out straight. Sky above the roofs becomes transparent: sky-like pixels connected to the top
// edge (windows that reflect the sky are enclosed by the facade and stay opaque).
// Run: npm run tool tools/rectify-facades.ts  →  reference/matterport/facades/<name>.png (RGBA)
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { CubePanorama } from "./lib/CubePanorama";
import { writeIfChanged } from "./lib/ImageOps";

const CONFIG_PATH = "tools/rectify-facades.json";
const BYTE = 255;
const LUMA = [0.299, 0.587, 0.114] as const;
const RGBA = 4;

interface FacadeSpec {
  name: string;
  source: string;
  face: "a" | "b" | "c" | "d";
  rect: [s0: number, s1: number, t0: number, t1: number];
  /** Optional: no sky below t = skyFloor.t for s in skyFloor.s (pale plaster fused with an overcast sky, e.g. the courtyard's top floor). */
  skyFloor?: { t: number; s: [number, number] };
}

interface Config {
  outDir: string;
  pxPerUnit: number;
  sky: { blueMin: number; cyanMin: number; brightLuma: number; brightSatMax: number; brightWarmMax: number; maxStep: number; featherPx: number };
  facades: FacadeSpec[];
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;

function skyLike(r: number, g: number, b: number): boolean {
  const luma = (LUMA[0] * r + LUMA[1] * g + LUMA[2] * b) / BYTE;
  const blue = (b - Math.max(r, g)) / BYTE;
  const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / BYTE;
  // Overcast sky is bright, grey and slightly cool; cream plaster is just as bright but warm (r − b).
  const warm = (r - b) / BYTE;
  // Pale sky near the horizon is cyan (g ≈ b); plaster always has r > b.
  const cyan = (b - r) / BYTE;
  return blue > config.sky.blueMin || cyan > config.sky.cyanMin || (luma > config.sky.brightLuma && sat < config.sky.brightSatMax && warm < config.sky.brightWarmMax);
}

/**
 * Sky = sky-like pixels reachable from the top row (4-connected flood fill) through smooth colour only: a step larger
 * than `maxStep` (a roof edge, a cornice) stops the fill, so pale plaster touching the sky is not swallowed.
 */
function skyMask(rgb: Uint8Array, w: number, h: number, floorRow: (x: number) => number): Uint8Array {
  const sky = new Uint8Array(w * h);
  const stack: number[] = [];
  const like = (p: number) => skyLike(rgb[p * 3]!, rgb[p * 3 + 1]!, rgb[p * 3 + 2]!);
  const smooth = (p: number, q: number) => {
    let step = 0;
    for (let c = 0; c < 3; c++) step = Math.max(step, Math.abs(rgb[p * 3 + c]! - rgb[q * 3 + c]!));
    return step / BYTE <= config.sky.maxStep;
  };
  for (let x = 0; x < w; x++) if (like(x)) {
    sky[x] = 1;
    stack.push(x);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < floorRow(x) ? p + w : -1];
    for (const q of neighbours) if (q >= 0 && sky[q] === 0 && like(q) && smooth(p, q)) {
      sky[q] = 1;
      stack.push(q);
    }
  }
  return sky;
}

async function rectify(spec: FacadeSpec): Promise<void> {
  const pano = await CubePanorama.load(spec.source);
  const [s0, s1, t0, t1] = spec.rect;
  const w = Math.round((s1 - s0) * config.pxPerUnit);
  const h = Math.round((t1 - t0) * config.pxPerUnit);
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const t = t1 - ((y + 0.5) / h) * (t1 - t0);
    for (let x = 0; x < w; x++) {
      const s = s0 + ((x + 0.5) / w) * (s1 - s0);
      const c = pano.sample(CubePanorama.planeDirection(spec.face, s, t));
      const o = (y * w + x) * 3;
      rgb[o] = Math.round(c[0]);
      rgb[o + 1] = Math.round(c[1]);
      rgb[o + 2] = Math.round(c[2]);
    }
  }
  const floor = spec.skyFloor;
  const floorRow = (x: number) => {
    if (floor === undefined) return h - 1;
    const s = s0 + ((x + 0.5) / w) * (s1 - s0);
    if (s < floor.s[0] || s > floor.s[1]) return h - 1;
    return Math.max(0, Math.min(h - 1, Math.round(((t1 - floor.t) / (t1 - t0)) * h)));
  };
  const sky = skyMask(rgb, w, h, floorRow);
  // Feathered alpha: blur the opaque mask a little so roof edges are not jagged.
  const opaque = Buffer.alloc(w * h);
  for (let p = 0; p < w * h; p++) opaque[p] = sky[p] ? 0 : BYTE;
  const alpha = await sharp(opaque, { raw: { width: w, height: h, channels: 1 } }).blur(config.sky.featherPx).extractChannel(0).raw().toBuffer();
  const rgba = Buffer.alloc(w * h * RGBA);
  for (let p = 0; p < w * h; p++) {
    rgba[p * RGBA] = rgb[p * 3]!;
    rgba[p * RGBA + 1] = rgb[p * 3 + 1]!;
    rgba[p * RGBA + 2] = rgb[p * 3 + 2]!;
    rgba[p * RGBA + 3] = alpha[p]!;
  }
  const png = await sharp(rgba, { raw: { width: w, height: h, channels: RGBA } }).png({ compressionLevel: 9 }).toBuffer();
  const path = `${config.outDir}/${spec.name}.png`;
  const changed = writeIfChanged(path, png);
  console.log(`rectify-facades: ${path} ${w}×${h} px, ${Math.round(png.length / 1024)} kB${changed ? "" : " (unchanged)"}`);
}

mkdirSync(config.outDir, { recursive: true });
for (const spec of config.facades) await rectify(spec);
