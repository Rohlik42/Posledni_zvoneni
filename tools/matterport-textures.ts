// Phase 7: stylised tiling textures from the Matterport reference (floor plans + panorama faces).
// Run: npm run tool tools/matterport-textures.ts   (parameters: tools/matterport-textures.json)
// Pipeline per texture: sample (crop / perspective quad / periodic fold / court-line extraction)
// → flatten baked lighting → colour adjust → seamless edges → resize ≤ 512 (optionally pixelated)
// → posterize (palette PNG) → public/textures/mp/<id>.png. Idempotent: files are rewritten only when bytes change.
import { readFileSync } from "node:fs";
import { extractCourtLines, type CourtLineParams } from "./lib/CourtLines";
import {
  adjust,
  crop,
  estimatePeriod,
  flatten,
  foldPeriodic,
  load,
  medianColour,
  recolour,
  resize,
  rotate90,
  savePng,
  seamless,
  fitDiamondChecker,
  tile,
  twoTone,
  warpQuad,
  type Img,
  type Point,
  type Rect,
} from "./lib/ImageOps";
import { updateIndex, type TextureEntry, type Tiling } from "./lib/TextureIndex";

const CONFIG_PATH = "tools/matterport-textures.json";

interface Processing {
  outPx: [number, number];
  colours: number;
  pixelate: number;
  /** Flatten baked lighting: blur sigma in sampled px (0 = off) and strength 0..1. */
  flattenSigma: number;
  flattenStrength: number;
  brightness: number;
  contrast: number;
  saturation: number;
  /** Fraction of the sample used to cross-fade opposite edges (repeating textures only). */
  seamBlend: number;
  /** Quarter turns applied after sampling (to orient boards/strips along v). */
  rotate: number;
}

interface SpecBase extends Partial<Processing> {
  id: string;
  kind: string;
  tiling: Tiling;
  src: string;
  notes: string;
  /** Source px per metre (plans 85, down faces measured); gives sizeM from the sample size. */
  pxPerM?: number;
  /** Explicit world size of the whole sample in metres (perspective quads). */
  sizeM?: [number, number];
  /** Keep the photo grain but take the colour from another reference area (median colour of `rect`). */
  recolourFrom?: { src: string; rect: Rect };
}

interface CropSpec extends SpecBase {
  method: "crop";
  rect: Rect;
  /** Snap the crop to whole pattern periods (autocorrelation search range in px). */
  periodSearchPx?: [number, number];
}
interface QuadSpec extends SpecBase {
  method: "quad";
  quad: [Point, Point, Point, Point];
  samplePx: [number, number];
}
interface FoldSpec extends SpecBase {
  method: "fold";
  rect: Rect;
  periodSearchPx: [number, number];
  cellPx: number;
  reps: number;
  /** Snap to the two tile colours (Otsu) keeping `keep` of the variation: crisp edges after the median fold. */
  twoTone?: { keep: number };
  /** Replace the tile geometry by an ideal 45° checker fitted to the photo (needs twoTone). */
  idealDiamond?: boolean;
}
interface LinesSpec extends SpecBase {
  method: "lines";
  rect: Rect;
  floor: number;
  lines: Omit<CourtLineParams, "pxPerM">;
}
type Spec = CropSpec | QuadSpec | FoldSpec | LinesSpec;

interface Config {
  outDir: string;
  license: string;
  defaults: Processing;
  textures: Spec[];
}

interface Sampled {
  img: Img;
  /** World size of `img` in metres, if known. */
  sizeM?: [number, number];
  note?: string;
}

async function sampleSpec(spec: Spec, cfg: Processing): Promise<Sampled> {
  const src = await load(spec.src);
  switch (spec.method) {
    case "crop": {
      let [l, t, w, h] = spec.rect;
      let note: string | undefined;
      if (spec.periodSearchPx) {
        // Whole periods + blend margin: the cross-fade then mixes identical phases and is invisible.
        const px = estimatePeriod(src, spec.rect, "x", spec.periodSearchPx);
        const py = estimatePeriod(src, spec.rect, "y", spec.periodSearchPx);
        const nx = Math.max(1, Math.floor(w / (1 + cfg.seamBlend) / px));
        const ny = Math.max(1, Math.floor(h / (1 + cfg.seamBlend) / py));
        w = Math.round(nx * px * (1 + cfg.seamBlend));
        h = Math.round(ny * py * (1 + cfg.seamBlend));
        note = `period ${px.toFixed(2)}×${py.toFixed(2)} px, ${nx}×${ny} periods`;
      }
      const img = crop(src, [l, t, w, h]);
      return { img, sizeM: spec.pxPerM ? [w / spec.pxPerM, h / spec.pxPerM] : spec.sizeM, note };
    }
    case "quad":
      return { img: warpQuad(src, spec.quad, spec.samplePx[0], spec.samplePx[1]), sizeM: spec.sizeM };
    case "fold": {
      const px = estimatePeriod(src, spec.rect, "x", spec.periodSearchPx);
      const py = estimatePeriod(src, spec.rect, "y", spec.periodSearchPx);
      let cell = foldPeriodic(src, spec.rect, px, py, spec.cellPx);
      let tones = "";
      if (spec.twoTone) {
        const res = twoTone(cell, spec.twoTone.keep);
        tones = `; dark rgb(${res.dark.join(",")}), light rgb(${res.light.join(",")})`;
        if (spec.idealDiamond) {
          const fit = fitDiamondChecker(cell, spec.twoTone.keep);
          cell = fit.img;
          tones += `; ideal 45° checker, phase (${fit.phase.map((v) => v.toFixed(3)).join(", ")}), ${(fit.agreement * 100).toFixed(1)} % px agree with the photo`;
        } else cell = res.img;
      }
      const ppm = spec.pxPerM ?? 1;
      const tileM = (px + py) / 2 / Math.SQRT2 / ppm;
      return {
        img: tile(cell, spec.reps, spec.reps),
        sizeM: [(spec.reps * px) / ppm, (spec.reps * py) / ppm],
        note: `lattice period ${px.toFixed(2)}×${py.toFixed(2)} px; tiles laid at 45°, tile edge ≈ ${(tileM * 100).toFixed(1)} cm${tones}`,
      };
    }
    case "lines":
      throw new Error("lines are handled separately");
  }
}

async function buildLines(spec: LinesSpec, cfg: Processing, outDir: string, license: string): Promise<[TextureEntry, boolean]> {
  const src = await load(spec.src);
  const img = crop(src, spec.rect);
  const ppm = spec.pxPerM ?? 1;
  const [outW, outH] = cfg.outPx;
  const res = extractCourtLines(img, { ...spec.lines, pxPerM: ppm }, outW, outH);
  const file = `${outDir}/${spec.id}.png`;
  const changed = await savePng(res.decal, file, cfg.colours);
  const counts = spec.lines.classes.map((c) => `${c.name} ${res.segments.filter((s) => s.cls === c.name).length}`).join(", ");
  console.log(`  ${spec.id}: segments ${counts}; colours ${JSON.stringify(res.colours)}`);
  return [
    {
      id: spec.id,
      group: "mp",
      file: file.replace(/^public\//, ""),
      px: [outW, outH],
      sizeM: [round3(spec.rect[2] / ppm), round3(spec.rect[3] / ppm)],
      tiling: spec.tiling,
      kind: spec.kind,
      source: spec.src,
      license,
      notes: `${spec.notes} Segments: ${counts}.`,
      plan: { floor: spec.floor, rectPx: spec.rect },
    },
    changed,
  ];
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

async function build(spec: Spec, defaults: Processing, outDir: string, license: string): Promise<[TextureEntry, boolean]> {
  const cfg: Processing = { ...defaults, ...spec } as Processing;
  if (spec.method === "lines") return buildLines(spec, cfg, outDir, license);
  const sampled = await sampleSpec(spec, cfg);
  let img = sampled.img;
  if (spec.recolourFrom) {
    const ref = crop(await load(spec.recolourFrom.src), spec.recolourFrom.rect);
    const target = medianColour(ref, new Uint8Array(ref.w * ref.h).fill(1));
    img = recolour(img, target);
    sampled.note = `${sampled.note ? `${sampled.note}; ` : ""}recoloured to rgb(${target.join(",")}) from ${spec.recolourFrom.src}`;
  }
  let sizeM = sampled.sizeM;
  if (cfg.rotate % 4 !== 0) {
    img = rotate90(img, cfg.rotate);
    if (sizeM && cfg.rotate % 2 !== 0) sizeM = [sizeM[1], sizeM[0]];
  }
  if (cfg.flattenSigma > 0) img = await flatten(img, cfg.flattenSigma, cfg.flattenStrength);
  img = adjust(img, cfg.brightness, cfg.contrast, cfg.saturation);
  const repeats = spec.tiling === "repeat" || spec.tiling === "repeat-x";
  if (repeats && cfg.seamBlend > 0 && spec.method !== "fold") {
    const before = [img.w, img.h];
    img = seamless(img, cfg.seamBlend, spec.tiling === "repeat" ? "xy" : "x");
    if (sizeM) sizeM = [(sizeM[0] * img.w) / (before[0] ?? img.w), (sizeM[1] * img.h) / (before[1] ?? img.h)];
  }
  if (!sizeM) throw new Error(`${spec.id}: needs pxPerM or sizeM`);
  const [outW, outH] = cfg.outPx;
  img = await resize(img, outW, outH, repeats, cfg.pixelate);
  const file = `${outDir}/${spec.id}.png`;
  const changed = await savePng(img, file, cfg.colours);
  if (sampled.note) console.log(`  ${spec.id}: ${sampled.note}`);
  return [
    {
      id: spec.id,
      group: "mp",
      file: file.replace(/^public\//, ""),
      px: [outW, outH],
      sizeM: [round3(sizeM[0]), round3(sizeM[1])],
      tiling: spec.tiling,
      kind: spec.kind,
      source: spec.src,
      license,
      notes: sampled.note ? `${spec.notes} Measured: ${sampled.note}.` : spec.notes,
    },
    changed,
  ];
}

async function main(): Promise<void> {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
  const only = process.argv.slice(2);
  const entries: TextureEntry[] = [];
  let changedFiles = 0;
  for (const spec of config.textures) {
    if (only.length && !only.includes(spec.id)) continue;
    const [entry, changed] = await build(spec, config.defaults, config.outDir, config.license);
    entries.push(entry);
    if (changed) changedFiles++;
    console.log(`${changed ? "wrote " : "same  "} ${entry.file}  ${entry.px.join("×")} px = ${entry.sizeM.join("×")} m`);
  }
  if (only.length) {
    console.log("partial run (ids given): index.json not updated");
    return;
  }
  const indexChanged = updateIndex("mp", entries);
  console.log(`${entries.length} textures, ${changedFiles} files changed, index ${indexChanged ? "updated" : "unchanged"}`);
}

await main();
