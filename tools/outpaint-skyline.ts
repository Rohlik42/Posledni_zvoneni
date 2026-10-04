// Paints in the city below the terrace parapet of the Prague panorama (FEEDBACK 2026-10-04: the facades pasted
// below the roofline did not match the photo above). The terrace photo is rendered as perspective views around the
// horizon with everything below the parapet curve in flat magenta; an image model (Gemini) fills the magenta with
// more Malá Strana. Views go round one after another and each sees the already painted part of its neighbour, so the
// painting continues across the overlap; the last view closes the circle. The views are projected back into one
// equirectangular band (azimuth × elevation) with feathered weights; tools/prague-skybox.ts uses the band below the
// curve and grades it to night with the rest.
// Run: npm run tool tools/outpaint-skyline.ts [--regenerate]   (needs GEMINI_API_KEY only for views not in cacheDir)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { CubePanorama, type Vec3 } from "./lib/CubePanorama";
import { writeIfChanged } from "./lib/ImageOps";

const CONFIG_PATH = "tools/outpaint-skyline.json";
const DEG = Math.PI / 180;
const FULL_TURN = 360;
const RGB = 3;
const BYTE = 255;
const API = "https://generativelanguage.googleapis.com/v1beta/models";
const RETRIES = 3;
const WEBP_ALPHA_QUALITY = 100;

interface Config {
  panorama: string;
  curve: string;
  out: string;
  cacheDir: string;
  model: string;
  band: { pxPerDeg: number; elTopDeg: number; elBottomDeg: number };
  view: { width: number; height: number; aspect: string; hfovDeg: number; pitchDeg: number; jpegQuality: number };
  views: { startAzDeg: number; stepDeg: number; count: number };
  feather: { edgePx: number; aboveCurveDeg: number; alphaWeight: number };
  mask: string;
  prompt: string;
  webpQuality: number;
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
const regenerate = process.argv.includes("--regenerate");
const curve = JSON.parse(readFileSync(config.curve, "utf8")) as { binDeg: number; elevationDeg: number[] };
const maskRgb = [1, 3, 5].map((i) => parseInt(config.mask.slice(i, i + 2), 16));

function curveAt(azDeg: number): number {
  const az = ((azDeg % FULL_TURN) + FULL_TURN) % FULL_TURN;
  const n = curve.elevationDeg.length;
  const f = az / curve.binDeg - 0.5;
  const i0 = Math.floor(f);
  const t = f - i0;
  const a = curve.elevationDeg[(i0 + n) % n]!;
  const b = curve.elevationDeg[(i0 + 1) % n]!;
  return a + (b - a) * t;
}

const direction = (azDeg: number, elDeg: number): Vec3 => [Math.sin(azDeg * DEG) * Math.cos(elDeg * DEG), Math.sin(elDeg * DEG), Math.cos(azDeg * DEG) * Math.cos(elDeg * DEG)];

// ---------------------------------------------------------------- band (equirect, accumulated with weights)

const { pxPerDeg, elTopDeg, elBottomDeg } = config.band;
const BW = Math.round(FULL_TURN * pxPerDeg);
const BH = Math.round((elTopDeg - elBottomDeg) * pxPerDeg);
const sum = new Float32Array(BW * BH * RGB);
const weight = new Float32Array(BW * BH);

const bandAz = (x: number) => (x + 0.5) / pxPerDeg;
const bandEl = (y: number) => elTopDeg - (y + 0.5) / pxPerDeg;

function bandSample(azDeg: number, elDeg: number): [number, number, number] | null {
  const x = Math.floor((((azDeg % FULL_TURN) + FULL_TURN) % FULL_TURN) * pxPerDeg) % BW;
  const y = Math.floor((elTopDeg - elDeg) * pxPerDeg);
  if (y < 0 || y >= BH) return null;
  const w = weight[y * BW + x]!;
  if (w <= 0) return null;
  const o = (y * BW + x) * RGB;
  return [sum[o]! / w, sum[o + 1]! / w, sum[o + 2]! / w];
}

// ---------------------------------------------------------------- views

interface Camera {
  fwd: Vec3;
  right: Vec3;
  up: Vec3;
  tanHalf: number;
}

function camera(azDeg: number): Camera {
  const p = config.view.pitchDeg * DEG;
  const a = azDeg * DEG;
  const fwd: Vec3 = [Math.sin(a) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p)];
  const right: Vec3 = [Math.cos(a), 0, -Math.sin(a)];
  const up: Vec3 = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
  return { fwd, right, up, tanHalf: Math.tan((config.view.hfovDeg / 2) * DEG) };
}

/** Renders the view: photo above the curve, already painted band below it, magenta where nothing is painted yet. */
function renderView(pano: CubePanorama, cam: Camera): Buffer {
  const { width: W, height: H } = config.view;
  const out = Buffer.alloc(W * H * RGB);
  for (let y = 0; y < H; y++) {
    const v = (1 - ((y + 0.5) / H) * 2) * cam.tanHalf * (H / W);
    for (let x = 0; x < W; x++) {
      const u = (((x + 0.5) / W) * 2 - 1) * cam.tanHalf;
      const d: Vec3 = [cam.fwd[0] + u * cam.right[0] + v * cam.up[0], cam.fwd[1] + u * cam.right[1] + v * cam.up[1], cam.fwd[2] + u * cam.right[2] + v * cam.up[2]];
      const az = (Math.atan2(d[0], d[2]) / DEG + FULL_TURN) % FULL_TURN;
      const el = Math.atan2(d[1], Math.hypot(d[0], d[2])) / DEG;
      const c = el >= curveAt(az) ? pano.sample(d) : (bandSample(az, el) ?? maskRgb);
      const o = (y * W + x) * RGB;
      out[o] = Math.round(c[0]!);
      out[o + 1] = Math.round(c[1]!);
      out[o + 2] = Math.round(c[2]!);
    }
  }
  return out;
}

async function callModel(jpeg: Buffer): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (key === undefined) throw new Error("outpaint-skyline: GEMINI_API_KEY is not set (needed for views missing from the cache)");
  const body = {
    contents: [{ parts: [{ text: config.prompt }, { inline_data: { mime_type: "image/jpeg", data: jpeg.toString("base64") } }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: config.view.aspect } },
  };
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const res = await fetch(`${API}/${config.model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
    const json = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data: string } }[] } }[]; error?: unknown };
    const data = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
    if (data !== undefined) return Buffer.from(data, "base64");
    console.warn(`outpaint-skyline: attempt ${attempt} returned no image: ${JSON.stringify(json).slice(0, 300)}`);
  }
  throw new Error("outpaint-skyline: the model returned no image");
}

/** Projects the painted view back into the band below the curve, feathered towards the image edges. */
function accumulate(painted: Buffer, cam: Camera): void {
  const { width: W, height: H } = config.view;
  const edge = config.feather.edgePx;
  for (let y = 0; y < BH; y++) {
    const el = bandEl(y);
    for (let x = 0; x < BW; x++) {
      const az = bandAz(x);
      if (el > curveAt(az) + config.feather.aboveCurveDeg) continue;
      const d = direction(az, el);
      const z = d[0] * cam.fwd[0] + d[1] * cam.fwd[1] + d[2] * cam.fwd[2];
      if (z <= 0) continue;
      const u = (d[0] * cam.right[0] + d[1] * cam.right[1] + d[2] * cam.right[2]) / z / cam.tanHalf;
      const v = (d[0] * cam.up[0] + d[1] * cam.up[1] + d[2] * cam.up[2]) / z / (cam.tanHalf * (H / W));
      const px = ((u + 1) / 2) * W - 0.5;
      const py = ((1 - v) / 2) * H - 0.5;
      if (px < 0 || py < 0 || px > W - 1 || py > H - 1) continue;
      const w = Math.min(1, Math.min(px, py, W - 1 - px, H - 1 - py) / edge);
      if (w <= 0) continue;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const tx = px - x0;
      const ty = py - y0;
      const o = (y * BW + x) * RGB;
      for (let c = 0; c < RGB; c++) {
        const p00 = painted[(y0 * W + x0) * RGB + c]!;
        const p10 = painted[(y0 * W + Math.min(W - 1, x0 + 1)) * RGB + c]!;
        const p01 = painted[(Math.min(H - 1, y0 + 1) * W + x0) * RGB + c]!;
        const p11 = painted[(Math.min(H - 1, y0 + 1) * W + Math.min(W - 1, x0 + 1)) * RGB + c]!;
        sum[o + c] = sum[o + c]! + w * ((p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty);
      }
      weight[y * BW + x] = weight[y * BW + x]! + w;
    }
  }
}

const pano = await CubePanorama.load(config.panorama);
mkdirSync(config.cacheDir, { recursive: true });
const { width: W, height: H } = config.view;
for (let i = 0; i < config.views.count; i++) {
  const az = config.views.startAzDeg + i * config.views.stepDeg;
  const cam = camera(az);
  const inputPath = `${config.cacheDir}/view-${String(i).padStart(2, "0")}-in.jpg`;
  const outputPath = `${config.cacheDir}/view-${String(i).padStart(2, "0")}-out.png`;
  const input = await sharp(renderView(pano, cam), { raw: { width: W, height: H, channels: RGB } }).jpeg({ quality: config.view.jpegQuality }).toBuffer();
  writeIfChanged(inputPath, input);
  if (regenerate || !existsSync(outputPath)) {
    const t = Date.now();
    writeFileSync(outputPath, await callModel(input));
    console.log(`outpaint-skyline: view ${i} (az ${az % FULL_TURN}°) painted by ${config.model} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  } else console.log(`outpaint-skyline: view ${i} (az ${az % FULL_TURN}°) from cache`);
  const painted = await sharp(outputPath).removeAlpha().resize(W, H, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  accumulate(painted, cam);
}

const band = Buffer.alloc(BW * BH * 4);
let covered = 0;
for (let p = 0; p < BW * BH; p++) {
  const w = weight[p]!;
  if (w > 0) covered++;
  for (let c = 0; c < RGB; c++) band[p * 4 + c] = w > 0 ? Math.round(Math.min(BYTE, sum[p * RGB + c]! / w)) : 0;
  // Soft coverage: the summed feather weight fades out where the views end (bottom edge of the band).
  band[p * 4 + 3] = Math.round(Math.min(1, w / config.feather.alphaWeight) * BYTE);
}
const webp = await sharp(band, { raw: { width: BW, height: BH, channels: 4 } }).webp({ quality: config.webpQuality, alphaQuality: WEBP_ALPHA_QUALITY }).toBuffer();
writeIfChanged(config.out, webp);
console.log(`outpaint-skyline: ${config.out} ${BW}×${BH} px, ${Math.round((covered / (BW * BH)) * 100)} % painted, ${Math.round(webp.length / 1024)} kB`);
