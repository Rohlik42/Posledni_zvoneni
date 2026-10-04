import peopleJson from "../../data/people.json";
import { DataLoader } from "../utils/DataLoader";
import { Palette } from "../utils/Palette";
import { Schema } from "../utils/Schema";

/** Bone roles the pose code uses → node names of the shared Quaternius rig (`CharacterArmature`). */
export const PERSON_BONES = [
  "hips",
  "body",
  "abdomen",
  "torso",
  "chest",
  "neck",
  "head",
  "headEnd",
  "upperArmL",
  "lowerArmL",
  "wristL",
  "upperArmR",
  "lowerArmR",
  "wristR",
  "upperLegL",
  "lowerLegL",
  "lowerLegEndL",
  "footL",
  "footEndL",
  "upperLegR",
  "lowerLegR",
  "lowerLegEndR",
  "footR",
  "footEndR",
] as const;
export type PersonBone = (typeof PERSON_BONES)[number];

export interface PersonModelData {
  /** File name under `directory`. */
  file: string;
  /** Gallery label. */
  title: string;
}

export interface PeopleData {
  /** Folder of the .glb files under `public/` (served at the Vite base URL). */
  directory: string;
  models: Record<string, PersonModelData>;
  /** Clip names: `idle` loops when standing, `greet` plays once after a teacher is freed. */
  animations: { idle: string; greet: string };
  material: { diffuseScale: number; baseEmissive: number; skinEmissive: number; skinMaterials: string[] };
  bones: Record<PersonBone, string>;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const COMMENT_PREFIX = "//";

/**
 * Typed loader for `data/people.json`: the glTF people (Quaternius, CC0) — files, the clips the game plays, the matte
 * material conversion and the bone names of the shared rig.
 */
export class PeopleConfig {
  static readonly file = "data/people.json";

  static readonly schema = Schema.object({
    directory: Schema.string(),
    models: Schema.record(Schema.object({ file: Schema.string(), title: Schema.string() })),
    animations: Schema.object({ idle: Schema.string(), greet: Schema.string() }),
    material: Schema.object({
      diffuseScale: Schema.number({ min: 0.05, max: 2 }),
      baseEmissive: Schema.number({ min: 0, max: 1 }),
      skinEmissive: Schema.number({ min: 0, max: 1 }),
      skinMaterials: Schema.array(Schema.string()),
    }),
    bones: Schema.object(Object.fromEntries(PERSON_BONES.map((bone) => [bone, Schema.string()]))),
  });

  private static cached: PeopleData | null = null;

  static load(): PeopleData {
    if (PeopleConfig.cached === null) PeopleConfig.cached = DataLoader.parse<PeopleData>(PeopleConfig.file, peopleJson, PeopleConfig.schema);
    return PeopleConfig.cached;
  }

  /** Model ids (keys of `models`, without comments). */
  static ids(): string[] {
    return Object.keys(PeopleConfig.load().models).filter((id) => !id.startsWith(COMMENT_PREFIX));
  }

  static model(id: string): PersonModelData {
    const model = PeopleConfig.load().models[id];
    if (model === undefined || id.startsWith(COMMENT_PREFIX)) throw new Error(`${PeopleConfig.file}: no person model "${id}"`);
    return model;
  }

  /** A recolour value is a `#rrggbb` colour or a palette key. */
  static isColor(value: string): boolean {
    return HEX_COLOR.test(value) || Palette.has(value);
  }

  /** `#rrggbb` of a recolour value (hex as is, palette keys resolved). */
  static hex(value: string): string {
    return HEX_COLOR.test(value) ? value : Palette.hex(value);
  }
}
