// People models (data/people.json): shrinks the Quaternius glTF characters for the web without any runtime decoder.
// Keeps only the animations the game plays (data/people.json → animations), drops TEXCOORD_0 (the models have no
// textures, colours are per material), resamples the remaining animation curves losslessly, deduplicates and prunes
// (keeping leaf bones such as Head_end, which the pose code uses as bone tips), and quantizes the vertex attributes
// (KHR_mesh_quantization — read natively by Babylon's glTF loader, no meshopt or Draco decoder from a CDN).
// Run: npm run tool tools/optimize-people.ts <source dir with the downloaded .glb files>
//   writes public/models/people/<file> for every model of data/people.json (source = <dir>/<file>).
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, resample } from "@gltf-transform/functions";

const PEOPLE_JSON = "data/people.json";
const OUT_DIR = "public/models/people";
/** glTF animation names are "<armature>|<clip>"; data/people.json names the clip. */
const CLIP_SEPARATOR = "|";
const UNUSED_ATTRIBUTES = ["TEXCOORD_0", "TEXCOORD_1"];
/** Bits per quantized attribute (14-bit positions keep sub-millimetre precision on a 2 m figure). */
const QUANTIZE = { quantizePosition: 14, quantizeNormal: 10, quantizeGeneric: 12 };
const KIB = 1024;

interface PeopleJson {
  models: Record<string, { file: string }>;
  animations: Record<string, string>;
}

const sourceDir = process.argv[2];
if (sourceDir === undefined) {
  console.error("usage: npm run tool tools/optimize-people.ts <source dir>");
  process.exit(2);
}

const people = JSON.parse(readFileSync(PEOPLE_JSON, "utf8")) as PeopleJson;
const keep = new Set(Object.entries(people.animations).filter(([key]) => !key.startsWith("//")).map(([, clip]) => clip));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
mkdirSync(OUT_DIR, { recursive: true });

let before = 0;
let after = 0;
for (const [id, model] of Object.entries(people.models)) {
  if (id.startsWith("//")) continue;
  const source = join(sourceDir, model.file);
  const target = join(OUT_DIR, model.file);
  const document = await io.read(source);
  const root = document.getRoot();
  for (const animation of root.listAnimations()) {
    const clip = animation.getName().split(CLIP_SEPARATOR).pop() ?? "";
    if (keep.has(clip)) animation.setName(clip);
    else {
      // Samplers and channels hold the keyframe accessors; disposing only the animation would leave them (and their data) behind.
      for (const channel of animation.listChannels()) channel.dispose();
      for (const sampler of animation.listSamplers()) sampler.dispose();
      animation.dispose();
    }
  }
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) for (const semantic of UNUSED_ATTRIBUTES) primitive.setAttribute(semantic, null);
  }
  await document.transform(resample(), dedup(), prune({ keepLeaves: true }), quantize(QUANTIZE));
  await io.write(target, document);
  const a = statSync(source).size;
  const b = statSync(target).size;
  before += a;
  after += b;
  console.log(`${model.file}: ${Math.round(a / KIB)} KiB → ${Math.round(b / KIB)} KiB (${root.listAnimations().length} animations)`);
}
console.log(`total: ${Math.round(before / KIB)} KiB → ${Math.round(after / KIB)} KiB`);
