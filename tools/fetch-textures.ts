// Phase 7: CC0 materials from Poly Haven that the Matterport tour does not have (concrete, rubble, burn, metal, rust).
// Run: npm run tool tools/fetch-textures.ts   (parameters: tools/fetch-textures.json)
// Downloads the 1K diffuse map once into public/textures/ph/raw/ (cache, md5-checked), then posterizes it to
// public/textures/ph/<id>.png like the Matterport textures. Idempotent; without network it silently uses the cache
// (or skips assets that were never downloaded). Only api.polyhaven.com and dl.polyhaven.org are contacted.
import { existsSync, readFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { load, resize, savePng, writeIfChanged } from "./lib/ImageOps";
import { readIndex, updateIndex, type TextureEntry } from "./lib/TextureIndex";

const CONFIG_PATH = "tools/fetch-textures.json";
const MM_PER_M = 1000;

interface Config {
  api: string;
  allowedHosts: string[];
  resolution: string;
  map: string;
  format: string;
  cacheDir: string;
  outDir: string;
  timeoutMs: number;
  license: string;
  process: { outPx: number; colours: number };
  textures: { id: string; asset: string; kind: string; notes: string }[];
}

interface FileInfo {
  url: string;
  md5: string;
  size: number;
}

interface Meta {
  /** Physical size of the scanned surface in millimetres. */
  dimensions?: [number, number];
  name?: string;
}

class Offline extends Error {}

async function getJson<T>(cfg: Config, url: string): Promise<T> {
  return (await (await fetchChecked(cfg, url)).json()) as T;
}

async function fetchChecked(cfg: Config, url: string): Promise<Response> {
  const host = new URL(url).hostname;
  if (!cfg.allowedHosts.includes(host)) throw new Error(`refusing to contact ${host} (only ${cfg.allowedHosts.join(", ")})`);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(cfg.timeoutMs) });
  } catch (err) {
    throw new Offline(`${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

function md5(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex");
}

/** Ensures the raw download exists in the cache; returns its path, or null when offline and not cached. */
async function ensureRaw(cfg: Config, asset: string): Promise<{ path: string; meta: Meta | null; url: string } | null> {
  const path = `${cfg.cacheDir}/${asset}_${cfg.map.toLowerCase()}_${cfg.resolution}.${cfg.format}`;
  const pageUrl = `https://polyhaven.com/a/${asset}`;
  if (existsSync(path)) return { path, meta: null, url: pageUrl };
  try {
    const files = await getJson<Record<string, Record<string, Record<string, FileInfo>>>>(cfg, `${cfg.api}/files/${asset}`);
    const info = files[cfg.map]?.[cfg.resolution]?.[cfg.format];
    if (!info) throw new Error(`${asset}: no ${cfg.map} ${cfg.resolution} ${cfg.format}`);
    const buf = Buffer.from(await (await fetchChecked(cfg, info.url)).arrayBuffer());
    if (md5(buf) !== info.md5) throw new Error(`${asset}: md5 mismatch`);
    writeIfChanged(`${path}.part`, buf);
    renameSync(`${path}.part`, path);
    console.log(`downloaded ${info.url} (${(buf.length / 1024).toFixed(0)} kB)`);
    const meta = await getJson<Meta>(cfg, `${cfg.api}/info/${asset}`);
    return { path, meta, url: pageUrl };
  } catch (err) {
    if (err instanceof Offline) {
      console.log(`offline, skipping ${asset} (${err.message})`);
      return null;
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const cfg = JSON.parse(readFileSync(process.argv[2] ?? CONFIG_PATH, "utf8")) as Config;
  // Physical sizes come from the API on first download; later (offline) runs reuse the index entry.
  const previous = new Map(readIndex().textures.filter((t) => t.group === "ph").map((t) => [t.id, t]));
  const entries: TextureEntry[] = [];
  let changed = 0;
  for (const t of cfg.textures) {
    const raw = await ensureRaw(cfg, t.asset);
    if (!raw) {
      const prev = previous.get(t.id);
      if (prev && existsSync(`public/${prev.file}`)) entries.push(prev);
      continue;
    }
    let meta = raw.meta;
    if (!meta && !previous.get(t.id)) {
      try {
        meta = await getJson<Meta>(cfg, `${cfg.api}/info/${t.asset}`);
      } catch (err) {
        if (!(err instanceof Offline)) throw err;
      }
    }
    const dims = meta?.dimensions;
    const sizeM: [number, number] = dims ? [dims[0] / MM_PER_M, dims[1] / MM_PER_M] : (previous.get(t.id)?.sizeM ?? [2, 2]);
    const img = await resize(await load(raw.path), cfg.process.outPx, cfg.process.outPx, true, 1);
    const file = `${cfg.outDir}/${t.id}.png`;
    if (await savePng(img, file, cfg.process.colours)) changed++;
    entries.push({
      id: t.id,
      group: "ph",
      file: file.replace(/^public\//, ""),
      px: [cfg.process.outPx, cfg.process.outPx],
      sizeM: [Math.round(sizeM[0] * 1000) / 1000, Math.round(sizeM[1] * 1000) / 1000],
      tiling: "repeat",
      kind: t.kind,
      source: raw.url,
      license: cfg.license,
      notes: `${t.notes} Posterized from ${raw.path.replace(/^public\//, "")} (${cfg.map} ${cfg.resolution}).`,
    });
  }
  const indexChanged = updateIndex("ph", entries);
  console.log(`${entries.length}/${cfg.textures.length} Poly Haven textures, ${changed} files changed, index ${indexChanged ? "updated" : "unchanged"}`);
}

await main();
