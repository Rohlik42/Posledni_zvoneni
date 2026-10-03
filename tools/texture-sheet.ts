// Phase 7: contact sheet of every texture in public/textures/index.json → screenshots/07-textures.png.
// Repeating textures are shown tiled 2×2 so seams are visible; decals are shown over their floor texture.
// Run: npm run tool tools/texture-sheet.ts   (no engine needed, sharp only)
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { readIndex, type TextureEntry } from "./lib/TextureIndex";

const OUT_PATH = "screenshots/07-textures.png";
const CELL = 320;
const LABEL_H = 44;
const COLS = 5;
const PAD = 12;
const BG = "#1b1d22";
const DECAL_BASE_ID = "floor-parquet-gym";
const TILE_REPEATS = 2;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders one texture into a CELL×CELL square: tiled, letterboxed or composited (decal). */
async function renderCell(t: TextureEntry, byId: Map<string, TextureEntry>): Promise<Buffer> {
  const path = `public/${t.file}`;
  const [w, h] = t.px;
  if (t.tiling === "repeat" || t.tiling === "repeat-x") {
    // Tile by world size so the aspect is true, scaled to fit the cell.
    const tw = Math.round((CELL / TILE_REPEATS) * Math.min(1, t.sizeM[0] / t.sizeM[1]));
    const th = Math.round((CELL / TILE_REPEATS) * Math.min(1, t.sizeM[1] / t.sizeM[0]));
    const one = await sharp(path).resize(tw, th, { fit: "fill", kernel: "nearest" }).png().toBuffer();
    const nx = Math.ceil(CELL / tw);
    const ny = Math.ceil(CELL / th);
    const comps = [];
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) comps.push({ input: one, left: x * tw, top: y * th });
    return sharp({ create: { width: nx * tw, height: ny * th, channels: 4, background: BG } })
      .composite(comps)
      .png()
      .toBuffer()
      .then((b) => sharp(b).extract({ left: 0, top: 0, width: Math.min(CELL, nx * tw), height: Math.min(CELL, ny * th) }).extend({ right: Math.max(0, CELL - nx * tw), bottom: Math.max(0, CELL - ny * th), background: BG }).png().toBuffer());
  }
  if (t.tiling === "decal") {
    const base = byId.get(DECAL_BASE_ID);
    const scale = CELL / Math.max(w, h);
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);
    let under: Buffer;
    if (base) {
      // Parquet repeated at its true world size under the whole decal.
      const rw = Math.max(1, Math.round((base.sizeM[0] / t.sizeM[0]) * dw));
      const rh = Math.max(1, Math.round((base.sizeM[1] / t.sizeM[1]) * dh));
      const one = await sharp(`public/${base.file}`).resize(rw, rh, { fit: "fill" }).png().toBuffer();
      const comps = [];
      for (let y = 0; y < dh; y += rh) for (let x = 0; x < dw; x += rw) comps.push({ input: one, left: x, top: y });
      under = await sharp({ create: { width: dw + rw, height: dh + rh, channels: 4, background: BG } }).composite(comps).png().toBuffer();
      under = await sharp(under).extract({ left: 0, top: 0, width: dw, height: dh }).png().toBuffer();
    } else {
      under = await sharp({ create: { width: dw, height: dh, channels: 4, background: "#555" } }).png().toBuffer();
    }
    const decal = await sharp(path).resize(dw, dh, { fit: "fill" }).png().toBuffer();
    const merged = await sharp(under).composite([{ input: decal }]).png().toBuffer();
    return sharp(merged).extend({ top: Math.floor((CELL - dh) / 2), bottom: Math.ceil((CELL - dh) / 2), left: Math.floor((CELL - dw) / 2), right: Math.ceil((CELL - dw) / 2), background: BG }).png().toBuffer();
  }
  return sharp(path).resize(CELL, CELL, { fit: "contain", background: BG }).png().toBuffer();
}

async function main(): Promise<void> {
  const index = readIndex();
  const list = index.textures;
  if (!list.length) throw new Error("public/textures/index.json is empty – run the texture tools first");
  const byId = new Map(list.map((t) => [t.id, t]));
  const rows = Math.ceil(list.length / COLS);
  const width = COLS * (CELL + PAD) + PAD;
  const height = rows * (CELL + LABEL_H + PAD) + PAD;
  const comps: sharp.OverlayOptions[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i] as TextureEntry;
    const left = PAD + (i % COLS) * (CELL + PAD);
    const top = PAD + Math.floor(i / COLS) * (CELL + LABEL_H + PAD);
    comps.push({ input: await renderCell(t, byId), left, top });
    const line1 = `${t.id}  [${t.group}] ${t.tiling}`;
    const line2 = `${t.px.join("×")} px · ${t.sizeM.join("×")} m`;
    const svg = `<svg width="${CELL}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg"><text x="2" y="17" font-family="Helvetica, Arial" font-size="15" fill="#f2f2f2">${escapeXml(line1)}</text><text x="2" y="37" font-family="Helvetica, Arial" font-size="13" fill="#9aa3ad">${escapeXml(line2)}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left, top: top + CELL });
  }
  mkdirSync("screenshots", { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: BG } }).composite(comps).png().toFile(OUT_PATH);
  console.log(`${OUT_PATH}: ${list.length} textures, ${width}×${height}`);
}

await main();
