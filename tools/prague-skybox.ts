// Phase F2 (FEEDBACK 2026-10-04): the night panorama of Prague as a skybox cube map — the real 360° photo from the
// school's roof terrace (reference/matterport/panoramas_4k/terasa_vyhled: a, b, c, d = four continuous side faces
// 4096², up = sky) converted day → night. It stays a PHOTO: roofs, sv. Mikuláš, the Castle and sv. Vít are the photo's
// own pixels, only exposed down, cooled and desaturated.
// Run: npm run tool tools/prague-skybox.ts   (parameters: tools/prague-skybox.json; DEBUG_DIR=<dir> also writes a cube
// cross of the result and of the sky mask with the parapet curve)
//
// Every mask is a continuous function of the direction (azimuth, elevation) and of blurred image values — nothing is
// searched or drawn per pixel column (F1's per-column skyline drew the vertical stripes of screenshots/24-game.png):
//   1. the four side faces are laid out as one padded horizontal strip d|a|b|c|d|a and blurred as a whole, so blurred
//      values (and every mask made of them) continue across the cube edges;
//   2. sky likelihood = grey or blue blurred colour above the horizon, plus a pure elevation prior high up;
//      buildings = photo × exposure (linear light), moonlit tint, low saturation; sky = dark blue gradient by elevation
//      + the photo's own clouds; fire glow = gaussians in azimuth fading with elevation (an angular gradient);
//   3. lit windows: dark spots inside bright façades (coarse − fine blur), a few of them chosen by smooth value noise in
//      angular coordinates (deterministic seed);
//   4. the terrace (paving, chairs, tables, the light parapet) lies below ONE smooth parapet curve elevation(azimuth):
//      a top-of-light-parapet estimate per azimuth bin, median over ±medianDeg and smoothed over ±smoothDeg; below
//      it the image fades within a 1–2° band into dark night haze; `down` = the same haze;
//   5. output: `public/textures/sky/prague_{px,nx,py,ny,pz,nz}.jpg` at `size`², written only when bytes change; every
//      entry of `variants` also writes a downscaled copy `prague<suffix>_*.jpg` (phase 21: 1024² for the Nízké preset).
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { writeIfChanged } from "./lib/ImageOps";
import { Palette } from "../src/utils/Palette";

const CONFIG_PATH = "tools/prague-skybox.json";
const DEG = Math.PI / 180;
const CHANNELS = 3;
const BYTE = 255;
const LUMA = [0.299, 0.587, 0.114] as const;
/** sRGB ↔ linear light, the simple power curve (the whole grade is a smooth tone map, exactness is not needed). */
const GAMMA = 2.2;
const SIDE_FILES = ["a", "b", "c", "d"] as const;
const QUARTER_TURN = 90;
const FULL_TURN = 360;
const HALF_TURN = 180;
/** Hash constants of the value noise (any large odd numbers; fixed so the output is deterministic). */
const HASH_X = 374761393;
const HASH_Y = 668265263;
const HASH_SEED = 2246822519;
const HASH_MIX = 1274126177;
const UINT32 = 4294967296;

type FaceId = "px" | "nx" | "py" | "ny" | "pz" | "nz";
type Rgb = [number, number, number];
type Range = [number, number];

interface Config {
  source: string;
  outDir: string;
  outPrefix: string;
  size: number;
  jpegQuality: number;
  variants?: { suffix: string; size: number }[];
  faces: Record<FaceId, { file: string; rotate?: number }>;
  blur: { padPx: number; class: number; fine: number; coarse: number };
  sky: { satMax: number; warmMax: number; lumaMin: number; lumaMinHigh: number; lumaMinDeg: Range; blueMin: number; blueSoft: number; soft: number; aboveDeg: Range; priorDeg: Range };
  parapet: {
    binDeg: number;
    stepDeg: number;
    searchTopDeg: number;
    searchBottomDeg: number;
    supportDeg: number;
    supportShare: number;
    tileWarmMin: number;
    tileSatMin: number;
    medianDeg: number;
    smoothDeg: number;
    minDeg: number;
    maxDeg: number;
    fallbackDeg: number;
    aboveDeg: number;
    bandDeg: number;
  };
  night: {
    exposure: number;
    saturation: number;
    tint: string;
    tintStrength: number;
    horizon: string;
    zenith: string;
    skyLevel: number;
    gradientDeg: number;
    cloud: string;
    cloudStrength: number;
    cloudBlack: number;
    cloudWhite: number;
    cloudGamma: number;
    haze: string;
    hazeLevel: number;
    hazeLift: number;
    hazeLiftDeg: number;
    hazeFireDeg: number;
  };
  fire: {
    colour: string;
    low: string;
    falloffDeg: number;
    onSky: number;
    cloudBoost: number;
    onBuildings: number;
    onHaze: number;
    sources: { azDeg: number; widthDeg: number; strength: number }[];
  };
  windows: {
    colour: string;
    strength: number;
    darkLo: number;
    darkHi: number;
    facadeLuma: Range;
    facadeWarm: Range;
    cellDeg: number;
    selectLo: number;
    selectHi: number;
    seed: number;
    elDeg: Range;
  };
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
const N = config.size;
const PAD = config.blur.padPx;
/** Strip of the side faces: PAD columns of d, a, b, c, d, PAD columns of a. */
const SW = SIDE_FILES.length * N + 2 * PAD;
const { night, fire, windows, parapet } = config;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const toLin = (v: number) => Math.pow(Math.max(0, v), GAMMA);
const toSrgb = (v: number) => Math.pow(clamp01(v), 1 / GAMMA);
const lumaOf = (c: Rgb) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];

/** Palette colour in linear light. */
function linColour(key: string): Rgb {
  const hex = Palette.hex(key);
  return [1, 3, 5].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16) / BYTE)) as Rgb;
}

const tintRaw = linColour(night.tint);
const tintLuma = lumaOf(tintRaw);
const C = {
  /** Moonlight tint normalised to luma 1, blended with white by tintStrength (keeps the exposure). */
  tint: tintRaw.map((v) => 1 + (v / tintLuma - 1) * night.tintStrength) as Rgb,
  horizon: linColour(night.horizon),
  zenith: linColour(night.zenith),
  cloud: linColour(night.cloud),
  haze: linColour(night.haze),
  fire: linColour(fire.colour),
  ember: linColour(fire.low),
  lamp: linColour(windows.colour),
};

// ---------------------------------------------------------------- directions

/** Azimuth and elevation (degrees) of side face `k` (0 = a), pixel (x, y) — cube face, so x/y are tangents. */
function sideAngles(k: number, x: number, y: number): { az: number; el: number } {
  const u = ((x + 0.5) / N) * 2 - 1;
  const v = ((y + 0.5) / N) * 2 - 1;
  return { az: k * QUARTER_TURN + Math.atan(u) / DEG, el: Math.atan2(-v, Math.sqrt(1 + u * u)) / DEG };
}

/** Strip pixel (fractional) of a direction below the up face (|el| < 45° near the face centre). */
function stripPixel(azDeg: number, elDeg: number): { sx: number; y: number } {
  const az = ((azDeg % FULL_TURN) + FULL_TURN) % FULL_TURN;
  const k = Math.round(az / QUARTER_TURN) % SIDE_FILES.length;
  const local = ((az - k * QUARTER_TURN + FULL_TURN + HALF_TURN) % FULL_TURN) - HALF_TURN;
  const u = Math.tan(local * DEG);
  const v = -Math.tan(elDeg * DEG) * Math.sqrt(1 + u * u);
  return { sx: PAD + k * N + ((u + 1) / 2) * N - 0.5, y: ((v + 1) / 2) * N - 0.5 };
}

function angularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % FULL_TURN;
  return d > HALF_TURN ? FULL_TURN - d : d;
}

/** Fire glow for a direction: gaussians in azimuth × exponential fall-off above the horizon (an angular gradient). */
function glowAt(azDeg: number, elDeg: number): number {
  let sum = 0;
  for (const source of fire.sources) sum += source.strength * Math.exp(-0.5 * (angularDistance(azDeg, source.azDeg) / source.widthDeg) ** 2);
  return sum * Math.exp(-Math.max(elDeg, 0) / fire.falloffDeg);
}

/** Fire colour: ember red at the horizon, orange higher up. */
function fireColour(elDeg: number): Rgb {
  const t = smoothstep(0, fire.falloffDeg, elDeg);
  return [C.ember[0] + (C.fire[0] - C.ember[0]) * t, C.ember[1] + (C.fire[1] - C.ember[1]) * t, C.ember[2] + (C.fire[2] - C.ember[2]) * t];
}

/** Smooth deterministic value noise 0..1 on a lattice of `cellDeg` (smoothstep interpolation of hashed corners). */
function hash(ix: number, iy: number): number {
  let h = (Math.imul(ix, HASH_X) + Math.imul(iy, HASH_Y) + Math.imul(windows.seed, HASH_SEED)) | 0;
  h = Math.imul(h ^ (h >>> 13), HASH_MIX);
  h ^= h >>> 16;
  return (h >>> 0) / UINT32;
}

function valueNoise(azDeg: number, elDeg: number): number {
  const az = ((azDeg % FULL_TURN) + FULL_TURN) % FULL_TURN;
  const cells = Math.round(FULL_TURN / windows.cellDeg);
  const fx = (az / FULL_TURN) * cells;
  const fy = elDeg / windows.cellDeg;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothstep(0, 1, fx - x0);
  const ty = smoothstep(0, 1, fy - y0);
  // The azimuth lattice wraps around the full turn, so the noise has no seam at az 0/360.
  const xa = ((x0 % cells) + cells) % cells;
  const xb = (xa + 1) % cells;
  const top = hash(xa, y0) + (hash(xb, y0) - hash(xa, y0)) * tx;
  const bottom = hash(xa, y0 + 1) + (hash(xb, y0 + 1) - hash(xa, y0 + 1)) * tx;
  return top + (bottom - top) * ty;
}

// ---------------------------------------------------------------- images

async function readFace(file: string): Promise<Buffer> {
  return sharp(`${config.source}/${file}.jpg`).resize(N, N, { kernel: "lanczos3" }).removeAlpha().raw().toBuffer();
}

/** The side faces as one strip d|a|b|c|d|a (PAD columns of the wrapped neighbours on both ends). */
function buildStrip(faces: Buffer[]): Buffer {
  const strip = Buffer.alloc(SW * N * CHANNELS);
  for (let y = 0; y < N; y++) {
    const row = y * SW * CHANNELS;
    const last = faces[faces.length - 1]!;
    last.copy(strip, row, (y * N + N - PAD) * CHANNELS, (y * N + N) * CHANNELS);
    for (const [k, face] of faces.entries()) face.copy(strip, row + (PAD + k * N) * CHANNELS, y * N * CHANNELS, (y + 1) * N * CHANNELS);
    faces[0]!.copy(strip, row + (PAD + faces.length * N) * CHANNELS, y * N * CHANNELS, (y * N + PAD) * CHANNELS);
  }
  return strip;
}

async function blurStrip(strip: Buffer, sigma: number): Promise<Buffer> {
  return sharp(strip, { raw: { width: SW, height: N, channels: CHANNELS } }).blur(sigma).raw().toBuffer();
}

/** Colour measures of a byte pixel at `i`: sRGB 0..1 luma, saturation, warmth (r − b), blueness (b − max(r, g)). */
function measures(img: Buffer, i: number): { luma: number; sat: number; warm: number; blue: number } {
  const r = img[i]! / BYTE;
  const g = img[i + 1]! / BYTE;
  const b = img[i + 2]! / BYTE;
  return { luma: LUMA[0] * r + LUMA[1] * g + LUMA[2] * b, sat: Math.max(r, g, b) - Math.min(r, g, b), warm: r - b, blue: b - Math.max(r, g) };
}

// ---------------------------------------------------------------- parapet curve

/**
 * Terrace foreground at a strip pixel of the class-blurred image: below the horizon everything that is not a red tile
 * roof (paving, the light parapet and its brick or copper cap, railing, tables) is the terrace.
 */
function isTerrace(cls: Buffer, sx: number, y: number): boolean {
  const xi = Math.min(SW - 1, Math.max(0, Math.round(sx)));
  const yi = Math.min(N - 1, Math.max(0, Math.round(y)));
  const m = measures(cls, (yi * SW + xi) * CHANNELS);
  return !(m.warm >= parapet.tileWarmMin && m.sat >= parapet.tileSatMin);
}

/** Circular median over ±half bins, ignoring missing (NaN) values. */
function circularMedian(values: Float64Array, half: number): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const window: number[] = [];
    for (let d = -half; d <= half; d++) {
      const v = values[(i + d + values.length) % values.length]!;
      if (!Number.isNaN(v)) window.push(v);
    }
    window.sort((p, q) => p - q);
    out[i] = window.length === 0 ? Number.NaN : window[Math.floor(window.length / 2)]!;
  }
  return out;
}

function circularMean(values: Float64Array, half: number): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    for (let d = -half; d <= half; d++) sum += values[(i + d + values.length) % values.length]!;
    out[i] = sum / (2 * half + 1);
  }
  return out;
}

/** Elevation of the parapet top for every azimuth bin: one smooth closed curve. */
function parapetCurve(cls: Buffer): Float64Array {
  const bins = Math.round(FULL_TURN / parapet.binDeg);
  const raw = new Float64Array(bins).fill(Number.NaN);
  const support = Math.round(parapet.supportDeg / parapet.stepDeg);
  for (let b = 0; b < bins; b++) {
    const az = (b + 0.5) * parapet.binDeg;
    const samples: boolean[] = [];
    for (let el = parapet.searchTopDeg; el >= parapet.searchBottomDeg; el -= parapet.stepDeg) {
      const { sx, y } = stripPixel(az, el);
      samples.push(isTerrace(cls, sx, y));
    }
    for (let s = 0; s + support <= samples.length; s++) {
      let hits = 0;
      for (let t = s; t < s + support; t++) if (samples[t]) hits++;
      if (samples[s] && hits / support >= parapet.supportShare) {
        raw[b] = parapet.searchTopDeg - s * parapet.stepDeg;
        break;
      }
    }
  }
  const median = circularMedian(raw, Math.round(parapet.medianDeg / parapet.binDeg));
  for (let b = 0; b < bins; b++) {
    const v = Number.isNaN(median[b]!) ? parapet.fallbackDeg : median[b]!;
    median[b] = Math.min(parapet.maxDeg, Math.max(parapet.minDeg, v));
  }
  return circularMean(median, Math.round(parapet.smoothDeg / parapet.binDeg));
}

function curveAt(curve: Float64Array, azDeg: number): number {
  const az = ((azDeg % FULL_TURN) + FULL_TURN) % FULL_TURN;
  const f = az / parapet.binDeg - 0.5;
  const i0 = Math.floor(f);
  const t = f - i0;
  const a = curve[(i0 + curve.length) % curve.length]!;
  const b = curve[(i0 + 1) % curve.length]!;
  return a + (b - a) * t;
}

// ---------------------------------------------------------------- grading

/** Night haze below the parapet (and the down face): fog colour, a trace of fire just under the horizon. */
function hazeAt(azDeg: number, elDeg: number): Rgb {
  const glow = glowAt(azDeg, 0) * fire.onHaze * Math.exp(-Math.max(-elDeg, 0) / night.hazeFireDeg);
  const f = fireColour(0);
  // A little lighter just under the parapet (the lit city below), darker further down.
  const level = night.hazeLevel * (1 + night.hazeLift * Math.exp(-Math.max(-elDeg, 0) / night.hazeLiftDeg));
  return [C.haze[0] * level + f[0] * glow, C.haze[1] * level + f[1] * glow, C.haze[2] * level + f[2] * glow];
}

/** Night sky for a direction and the photo's luma there (its own clouds). */
function skyAt(azDeg: number, elDeg: number, photoLuma: number): Rgb {
  const t = smoothstep(0, night.gradientDeg, elDeg);
  const cloud = Math.pow(clamp01((photoLuma - night.cloudBlack) / (night.cloudWhite - night.cloudBlack)), night.cloudGamma);
  const glow = glowAt(azDeg, elDeg) * fire.onSky * (1 + fire.cloudBoost * cloud);
  const f = fireColour(elDeg);
  const out: Rgb = [0, 0, 0];
  for (let c = 0; c < CHANNELS; c++) {
    const base = (C.horizon[c]! + (C.zenith[c]! - C.horizon[c]!) * t) * night.skyLevel;
    out[c] = base + C.cloud[c]! * cloud * night.cloudStrength + f[c]! * glow;
  }
  return out;
}

/** Sky likelihood 0..1 from blurred colour and elevation (continuous, no search). */
function skyLikelihood(m: { luma: number; sat: number; warm: number; blue: number }, elDeg: number): number {
  const s = config.sky;
  // Dark grey domes and slate roofs sit low; clouds higher up may be darker: the luma threshold falls with elevation.
  const lumaMin = s.lumaMin + (s.lumaMinHigh - s.lumaMin) * smoothstep(s.lumaMinDeg[0], s.lumaMinDeg[1], elDeg);
  const grey = smoothstep(s.satMax + s.soft, s.satMax, m.sat) * smoothstep(s.warmMax + s.soft, s.warmMax, m.warm) * smoothstep(lumaMin - s.soft, lumaMin + s.soft, m.luma);
  const blue = smoothstep(s.blueMin, s.blueMin + s.blueSoft, m.blue);
  const colour = Math.max(grey, blue) * smoothstep(s.aboveDeg[0], s.aboveDeg[1], elDeg);
  return Math.max(colour, smoothstep(s.priorDeg[0], s.priorDeg[1], elDeg));
}

interface SideResult {
  rgb: Float32Array;
  sky: Float32Array;
}

/** One graded side face (linear light) and its sky mask. */
function gradeSide(k: number, photo: Buffer, cls: Buffer, fine: Buffer, coarse: Buffer, curve: Float64Array): SideResult {
  const rgb = new Float32Array(N * N * CHANNELS);
  const skyMask = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const { az, el } = sideAngles(k, x, y);
      const i = (y * SW + PAD + k * N + x) * CHANNELS;
      const p: Rgb = [toLin(photo[i]! / BYTE), toLin(photo[i + 1]! / BYTE), toLin(photo[i + 2]! / BYTE)];
      const pl = lumaOf(p);
      const photoLuma = measures(photo, i).luma;
      // The coarse blur keeps the mask smooth inside clouds (no speckles where cloud luma crosses the thresholds).
      const sky = skyLikelihood(measures(coarse, i), el);

      // Buildings: the photo exposed down, desaturated, moonlit, lit a little by the fires.
      const glow = glowAt(az, el) * fire.onBuildings;
      const f = fireColour(el);
      // Lit windows: dark spots in bright warm façades, a few chosen by smooth angular noise.
      const dark = measures(coarse, i).luma - measures(fine, i).luma;
      const facade = smoothstep(windows.facadeLuma[0], windows.facadeLuma[1], measures(coarse, i).luma) * smoothstep(windows.facadeWarm[0], windows.facadeWarm[1], measures(coarse, i).warm);
      const chosen = smoothstep(windows.selectLo, windows.selectHi, valueNoise(az, el));
      const inBand = smoothstep(windows.elDeg[0], windows.elDeg[0] + 0.5, el) * smoothstep(windows.elDeg[1], windows.elDeg[1] - 1, el);
      const lit = smoothstep(windows.darkLo, windows.darkHi, dark) * facade * chosen * inBand * (1 - sky) * windows.strength;
      const skyColour = skyAt(az, el, photoLuma);

      // Below the parapet curve: the terrace fades into the night haze.
      const top = curveAt(curve, az);
      const below = smoothstep(top + parapet.aboveDeg, top - parapet.bandDeg, el);
      const haze = hazeAt(az, el);
      const o = (y * N + x) * CHANNELS;
      for (let c = 0; c < CHANNELS; c++) {
        const desat = pl + (p[c]! - pl) * night.saturation;
        const building = desat * C.tint[c]! * night.exposure + f[c]! * glow * pl + C.lamp[c]! * lit;
        const value = building + (skyColour[c]! - building) * sky;
        rgb[o + c] = value + (haze[c]! - value) * below;
      }
      skyMask[y * N + x] = sky * (1 - below);
    }
  }
  return { rgb, sky: skyMask };
}

/** The up face as the photo has it (bottom edge against side a): all sky. */
function gradeUp(photo: Buffer): Float32Array {
  const rgb = new Float32Array(N * N * CHANNELS);
  for (let y = 0; y < N; y++) {
    const v = ((y + 0.5) / N) * 2 - 1;
    for (let x = 0; x < N; x++) {
      const u = ((x + 0.5) / N) * 2 - 1;
      // Bottom edge (v = +1) faces side a (azimuth 0), right edge side b (90°).
      const az = (Math.atan2(u, v) / DEG + FULL_TURN) % FULL_TURN;
      const el = Math.atan2(1, Math.hypot(u, v)) / DEG;
      const i = (y * N + x) * CHANNELS;
      rgb.set(skyAt(az, el, measures(photo, i).luma), i);
    }
  }
  return rgb;
}

/** The down face: haze in every direction (bottom edge of the side faces is far below the parapet). */
function gradeDown(): Float32Array {
  const rgb = new Float32Array(N * N * CHANNELS);
  for (let y = 0; y < N; y++) {
    const v = ((y + 0.5) / N) * 2 - 1;
    for (let x = 0; x < N; x++) {
      const u = ((x + 0.5) / N) * 2 - 1;
      const az = (Math.atan2(u, v) / DEG + FULL_TURN) % FULL_TURN;
      const el = -Math.atan2(1, Math.hypot(u, v)) / DEG;
      rgb.set(hazeAt(az, el), (y * N + x) * CHANNELS);
    }
  }
  return rgb;
}

// ---------------------------------------------------------------- output

function toBytes(rgb: Float32Array): Buffer {
  const out = Buffer.alloc(rgb.length);
  for (let i = 0; i < rgb.length; i++) out[i] = Math.round(toSrgb(rgb[i]!) * BYTE);
  return out;
}

async function encode(bytes: Buffer, rotate: number, size: number): Promise<Buffer> {
  let image = sharp(bytes, { raw: { width: N, height: N, channels: CHANNELS } });
  if (rotate !== 0) image = image.rotate(rotate);
  if (size !== N) image = sharp(await image.png().toBuffer()).resize(size, size, { kernel: "lanczos3" });
  return image.jpeg({ quality: config.jpegQuality, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
}

const sideBuffers = await Promise.all(SIDE_FILES.map((file) => readFace(file)));
const strip = buildStrip(sideBuffers);
const [cls, fine, coarse] = await Promise.all([blurStrip(strip, config.blur.class), blurStrip(strip, config.blur.fine), blurStrip(strip, config.blur.coarse)]);
const curve = parapetCurve(cls);
if (process.env.DEBUG_DIR !== undefined) {
  const every = Math.round(10 / parapet.binDeg);
  console.log(`parapet curve every 10°: ${Array.from(curve.filter((_, i) => i % every === 0), (v) => v.toFixed(2)).join(" ")}`);
}
console.log(`prague-skybox: parapet curve ${Math.min(...curve).toFixed(2)}° … ${Math.max(...curve).toFixed(2)}°`);

const graded = new Map<string, Buffer>();
const skyMasks: Float32Array[] = [];
for (const [k, file] of SIDE_FILES.entries()) {
  const { rgb, sky } = gradeSide(k, strip, cls, fine, coarse, curve);
  graded.set(file, toBytes(rgb));
  skyMasks.push(sky);
}
graded.set("up", toBytes(gradeUp(await readFace("up"))));
graded.set("down", toBytes(gradeDown()));

const outputs = [{ prefix: config.outPrefix, size: N }, ...(config.variants ?? []).map((v) => ({ prefix: `${config.outPrefix}${v.suffix}`, size: v.size }))];
for (const output of outputs) {
  let changed = 0;
  let bytes = 0;
  for (const [face, { file, rotate }] of Object.entries(config.faces) as Array<[FaceId, { file: string; rotate?: number }]>) {
    const source = graded.get(file);
    if (source === undefined) throw new Error(`prague-skybox: unknown source face "${file}"`);
    const path = `${config.outDir}/${output.prefix}_${face}.jpg`;
    const jpeg = await encode(source, rotate ?? 0, output.size);
    bytes += jpeg.length;
    if (writeIfChanged(path, jpeg)) changed++;
  }
  console.log(`prague-skybox: ${changed} of 6 faces changed (${output.size}², ${config.outDir}/${output.prefix}_*.jpg, ${Math.round(bytes / 1024)} kB)`);
}

const debugDir = process.env.DEBUG_DIR;
if (debugDir !== undefined) {
  // Cube cross in the source layout: up above a; a b c d in a row; down below a. Second image: sky mask + parapet curve.
  const S = N / 4;
  const small = async (bytes: Buffer) => sharp(bytes, { raw: { width: N, height: N, channels: CHANNELS } }).resize(S, S).png().toBuffer();
  const cross = async (faces: Map<string, Buffer>, out: string) => {
    const tiles = [
      { input: await small(faces.get("up")!), left: 0, top: 0 },
      { input: await small(faces.get("down")!), left: 0, top: 2 * S },
    ];
    for (const [k, file] of SIDE_FILES.entries()) tiles.push({ input: await small(faces.get(file)!), left: k * S, top: S });
    await sharp({ create: { width: 4 * S, height: 3 * S, channels: 3, background: "#000" } }).composite(tiles).png().toFile(out);
    console.log(`debug: ${out}`);
  };
  await cross(graded, `${debugDir}/prague-skybox-cross.png`);
  const maskFaces = new Map<string, Buffer>();
  for (const [k, file] of SIDE_FILES.entries()) {
    const grey = Buffer.alloc(N * N * CHANNELS);
    for (let p = 0; p < N * N; p++) grey.fill(Math.round(skyMasks[k]![p]! * BYTE), p * CHANNELS, p * CHANNELS + CHANNELS);
    // Parapet curve in red.
    for (let x = 0; x < N; x++) {
      const { az } = sideAngles(k, x, 0);
      const u = ((x + 0.5) / N) * 2 - 1;
      const row = Math.round(((-Math.tan(curveAt(curve, az) * DEG) * Math.sqrt(1 + u * u) + 1) / 2) * N - 0.5);
      for (let t = -2; t <= 2; t++) {
        const o = ((row + t) * N + x) * CHANNELS;
        grey[o] = BYTE;
        grey[o + 1] = 0;
        grey[o + 2] = 0;
      }
    }
    maskFaces.set(file, grey);
  }
  maskFaces.set("up", Buffer.alloc(N * N * CHANNELS, BYTE));
  maskFaces.set("down", Buffer.alloc(N * N * CHANNELS));
  await cross(maskFaces, `${debugDir}/prague-skybox-mask.png`);
}
