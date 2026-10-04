// Phase F1: night panorama of Prague as a skybox cube map, from the Matterport terrace panorama
// (reference/matterport/panoramas_4k/terasa_vyhled: a, b, c, d = four continuous side faces 4096², up = sky).
// Run: npm run tool tools/prague-skybox.ts   (parameters: tools/prague-skybox.json; DEBUG_DIR=<dir> also writes the
// sky/silhouette masks and a cross preview of the result)
//
// Per side face, in direction space (so neighbouring faces meet without a seam):
//   1. skyline: per image column (= a vertical great circle) the sky runs from the top until the first run of
//      non-bluish pixels (roofs, towers, chimneys); everything below the horizon is ground — this drops the terrace
//      (tiles, chairs, tables, parapet), which all lie below the horizon line;
//   2. night grading (DESIGN §1): dark blue gradient by elevation, clouds kept from the photo as moonlit structure,
//      fire glow behind the roofs by azimuth (orange near the horizon, fading upward), smoke darkening near the fires;
//      buildings become a near-black silhouette with a trace of the photo and the fire rim (sv. Mikuláš and the
//      Castle stay recognisable by their outline); ground = dark;
//   3. output: `public/textures/sky/prague_{px,nx,py,ny,pz,nz}.jpg` at `size`², written only when bytes change; every
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
const SIDE_FILES = ["a", "b", "c", "d"] as const;
/** Azimuth of the centre of each side file, degrees (a → b → c → d turns right). */
const SIDE_AZIMUTH: Record<string, number> = { a: 0, b: 90, c: 180, d: 270 };
const FULL_TURN = 360;
const HALF_TURN = 180;

type FaceId = "px" | "nx" | "py" | "ny" | "pz" | "nz";
type Rgb = [number, number, number];

interface Fire {
  azDeg: number;
  widthDeg: number;
  strength: number;
}

interface Config {
  source: string;
  outDir: string;
  outPrefix: string;
  size: number;
  jpegQuality: number;
  /** Downscaled copies of the same faces (phase 21 quality presets). */
  variants?: { suffix: string; size: number }[];
  faces: Record<FaceId, { file: string; rotate?: number }>;
  skyline: {
    blurSigma: number;
    minBlueOverRed: number;
    minBlueOverGreen: number;
    minRunPx: number;
    brightSkyLuma: number;
    medianPasses: number;
    horizonDeg: number;
    maskSoftenPx: number;
  };
  night: {
    zenith: string;
    horizon: string;
    gradientDeg: number;
    cloud: string;
    cloudStrength: number;
    cloudGamma: number;
    silhouette: string;
    silhouetteDetail: number;
    silhouetteTint: string;
    ground: string;
    groundFeatherDeg: number;
    glow: string;
    ember: string;
    glowFalloffDeg: number;
    glowOnClouds: number;
    glowOnSilhouette: number;
    smoke: string;
    smokeStrength: number;
    fires: Fire[];
  };
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
const N = config.size;
const night = config.night;

function colour(key: string): Rgb {
  const hex = Palette.hex(key);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / BYTE) as Rgb;
}

const C = {
  zenith: colour(night.zenith),
  horizon: colour(night.horizon),
  cloud: colour(night.cloud),
  silhouette: colour(night.silhouette),
  tint: colour(night.silhouetteTint),
  ground: colour(night.ground),
  glow: colour(night.glow),
  ember: colour(night.ember),
  smoke: colour(night.smoke),
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Fire glow strength for a direction (sum of azimuth gaussians, fading with elevation). */
function glowAt(azDeg: number, elDeg: number): number {
  let sum = 0;
  for (const fire of night.fires) {
    let d = Math.abs(azDeg - fire.azDeg) % FULL_TURN;
    if (d > HALF_TURN) d = FULL_TURN - d;
    sum += fire.strength * Math.exp(-0.5 * (d / fire.widthDeg) ** 2);
  }
  return sum * Math.exp(-Math.max(elDeg, 0) / night.glowFalloffDeg);
}

/** Night sky colour for a direction and the photo luminance there (cloud structure). */
function skyColour(azDeg: number, elDeg: number, luma: number): Rgb {
  const base = mix(C.horizon, C.zenith, smoothstep(0, night.gradientDeg, elDeg));
  const cloud = Math.pow(luma, night.cloudGamma) * night.cloudStrength;
  const glow = glowAt(azDeg, elDeg);
  const fire = mix(C.ember, C.glow, smoothstep(0, night.glowFalloffDeg, elDeg));
  const lit = night.glowOnClouds * glow * (0.3 + luma);
  let c: Rgb = [base[0] + C.cloud[0] * cloud + fire[0] * lit, base[1] + C.cloud[1] * cloud + fire[1] * lit, base[2] + C.cloud[2] * cloud + fire[2] * lit];
  c = mix(c, C.smoke, night.smokeStrength * (1 - luma) * Math.min(1, glow));
  return c;
}

async function readFace(file: string, blur: number): Promise<Float32Array> {
  let pipeline = sharp(`${config.source}/${file}.jpg`).resize(N, N, { kernel: "lanczos3" }).removeAlpha();
  if (blur > 0) pipeline = pipeline.blur(blur);
  const raw = await pipeline.raw().toBuffer();
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i]! / BYTE;
  return out;
}

/** Image row (fractional) where a side face column `x` crosses elevation `elDeg`. */
function rowAtElevation(x: number, elDeg: number): number {
  const u = ((x + 0.5) / N) * 2 - 1;
  const v = -Math.tan(elDeg * DEG) * Math.sqrt(1 + u * u);
  return ((v + 1) / 2) * N - 0.5;
}

/** First row of the silhouette in every column (sky above it), capped at the horizon. */
function skyline(blurred: Float32Array): Float32Array {
  const { minBlueOverRed, minBlueOverGreen, minRunPx, horizonDeg, brightSkyLuma, medianPasses } = config.skyline;
  const rows = new Float32Array(N);
  for (let x = 0; x < N; x++) {
    const horizon = rowAtElevation(x, horizonDeg);
    let found = horizon;
    let run = 0;
    for (let y = 0; y < Math.min(N, Math.ceil(horizon)); y++) {
      const i = (y * N + x) * CHANNELS;
      const [r, g, b] = [blurred[i]! * BYTE, blurred[i + 1]! * BYTE, blurred[i + 2]! * BYTE];
      const luma = (LUMA[0] * r + LUMA[1] * g + LUMA[2] * b) / BYTE;
      const sky = (b - r >= minBlueOverRed && b - g >= minBlueOverGreen) || luma >= brightSkyLuma;
      run = sky ? 0 : run + 1;
      if (run >= minRunPx) {
        found = y - run + 1;
        break;
      }
    }
    rows[x] = Math.min(found, horizon);
  }
  // A 3-wide median removes one-column streaks (a cloud pixel run misread as a mast) and keeps towers and spires.
  let current = rows;
  for (let pass = 0; pass < medianPasses; pass++) {
    const next = new Float32Array(N);
    for (let x = 0; x < N; x++) {
      const trio = [current[Math.max(0, x - 1)]!, current[x]!, current[Math.min(N - 1, x + 1)]!].sort((p, q) => p - q);
      next[x] = trio[1]!;
    }
    current = next;
  }
  return current;
}

async function sideFace(file: string): Promise<{ rgb: Float32Array; mask: Float32Array }> {
  const photo = await readFace(file, 0);
  const rows = skyline(await readFace(file, config.skyline.blurSigma));
  const rgb = new Float32Array(N * N * CHANNELS);
  const mask = new Float32Array(N * N);
  const azCentre = SIDE_AZIMUTH[file]!;
  const soften = config.skyline.maskSoftenPx;
  for (let y = 0; y < N; y++) {
    const v = ((y + 0.5) / N) * 2 - 1;
    for (let x = 0; x < N; x++) {
      const u = ((x + 0.5) / N) * 2 - 1;
      const az = azCentre + Math.atan(u) / DEG;
      const el = Math.atan2(-v, Math.sqrt(1 + u * u)) / DEG;
      const i = (y * N + x) * CHANNELS;
      const p: Rgb = [photo[i]!, photo[i + 1]!, photo[i + 2]!];
      const luma = LUMA[0] * p[0] + LUMA[1] * p[1] + LUMA[2] * p[2];
      const sky = clamp01((rows[x]! - y) / soften + 0.5);
      const sil: Rgb = [
        C.silhouette[0] + p[0] * night.silhouetteDetail * C.tint[0] * 4,
        C.silhouette[1] + p[1] * night.silhouetteDetail * C.tint[1] * 4,
        C.silhouette[2] + p[2] * night.silhouetteDetail * C.tint[2] * 4,
      ];
      const rim = glowAt(az, Math.max(el, 0)) * night.glowOnSilhouette;
      const building: Rgb = [sil[0] + C.ember[0] * rim, sil[1] + C.ember[1] * rim, sil[2] + C.ember[2] * rim];
      let c = mix(building, skyColour(az, el, luma), sky);
      c = mix(c, C.ground, smoothstep(config.skyline.horizonDeg, config.skyline.horizonDeg - night.groundFeatherDeg, el));
      rgb.set(c, i);
      mask[y * N + x] = sky;
    }
  }
  return { rgb, mask };
}

/** The up face as the photo has it (bottom edge against side a), all sky. */
async function upFace(): Promise<Float32Array> {
  const photo = await readFace("up", 0);
  const rgb = new Float32Array(N * N * CHANNELS);
  for (let y = 0; y < N; y++) {
    const v = ((y + 0.5) / N) * 2 - 1;
    for (let x = 0; x < N; x++) {
      const u = ((x + 0.5) / N) * 2 - 1;
      // Bottom edge (v = +1) faces side a (azimuth 0), right edge side b (90°).
      const az = (Math.atan2(u, v) / DEG + FULL_TURN) % FULL_TURN;
      const el = Math.atan2(1, Math.hypot(u, v)) / DEG;
      const i = (y * N + x) * CHANNELS;
      const luma = LUMA[0] * photo[i]! + LUMA[1] * photo[i + 1]! + LUMA[2] * photo[i + 2]!;
      rgb.set(skyColour(az, el, luma), i);
    }
  }
  return rgb;
}

function groundFace(): Float32Array {
  const rgb = new Float32Array(N * N * CHANNELS);
  for (let p = 0; p < N * N; p++) rgb.set(C.ground, p * CHANNELS);
  return rgb;
}

function toBytes(rgb: Float32Array): Buffer {
  const out = Buffer.alloc(rgb.length);
  for (let i = 0; i < rgb.length; i++) out[i] = Math.round(clamp01(rgb[i]!) * BYTE);
  return out;
}

async function encode(rgb: Float32Array, rotate: number, size: number): Promise<Buffer> {
  let image = sharp(toBytes(rgb), { raw: { width: N, height: N, channels: CHANNELS } });
  if (rotate !== 0) image = image.rotate(rotate);
  if (size !== N) image = sharp(await image.png().toBuffer()).resize(size, size, { kernel: "lanczos3" });
  return image.jpeg({ quality: config.jpegQuality, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
}

const sources = new Map<string, Float32Array>();
const masks = new Map<string, Float32Array>();
for (const file of SIDE_FILES) {
  const { rgb, mask } = await sideFace(file);
  sources.set(file, rgb);
  masks.set(file, mask);
}
sources.set("up", await upFace());
sources.set("down", groundFace());

const outputs = [{ prefix: config.outPrefix, size: N }, ...(config.variants ?? []).map((v) => ({ prefix: `${config.outPrefix}${v.suffix}`, size: v.size }))];
for (const output of outputs) {
  let changed = 0;
  for (const [face, { file, rotate }] of Object.entries(config.faces) as Array<[FaceId, { file: string; rotate?: number }]>) {
    const rgb = sources.get(file);
    if (rgb === undefined) throw new Error(`prague-skybox: unknown source face "${file}"`);
    const path = `${config.outDir}/${output.prefix}_${face}.jpg`;
    if (writeIfChanged(path, await encode(rgb, rotate ?? 0, output.size))) changed++;
  }
  console.log(`prague-skybox: ${changed} of 6 faces changed (${output.size}², ${config.outDir}/${output.prefix}_*.jpg)`);
}

const debugDir = process.env.DEBUG_DIR;
if (debugDir !== undefined) {
  // Cross preview in the source layout: up above a; a b c d in a row; masks below.
  const S = N / 4;
  const small = async (rgb: Float32Array) => sharp(toBytes(rgb), { raw: { width: N, height: N, channels: CHANNELS } }).resize(S, S).png().toBuffer();
  const tiles = [{ input: await small(sources.get("up")!), left: 0, top: 0 }];
  for (const [k, file] of SIDE_FILES.entries()) {
    tiles.push({ input: await small(sources.get(file)!), left: k * S, top: S });
    const m = masks.get(file)!;
    const grey = new Float32Array(N * N * CHANNELS);
    for (let p = 0; p < N * N; p++) grey.fill(m[p]!, p * CHANNELS, p * CHANNELS + CHANNELS);
    tiles.push({ input: await small(grey), left: k * S, top: 2 * S });
  }
  await sharp({ create: { width: 4 * S, height: 3 * S, channels: 3, background: "#000" } }).composite(tiles).png().toFile(`${debugDir}/prague-skybox-cross.png`);
  console.log(`debug: ${debugDir}/prague-skybox-cross.png`);
}
