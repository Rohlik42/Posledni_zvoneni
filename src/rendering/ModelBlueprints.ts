import modelsJson from "../../data/models.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

export const MODEL_CATEGORIES = ["weapon", "robot", "teacher", "prop", "pickup", "room"] as const;
export type ModelCategory = (typeof MODEL_CATEGORIES)[number];

export const PART_SHAPES = ["box", "cylinder"] as const;
export type PartShape = (typeof PART_SHAPES)[number];

export type Vec3Tuple = [number, number, number];

/** One primitive of a blueprint. `size` is [w, h, d] for a box and [diameterTop, height, diameterBottom] for a cylinder. */
export interface BlueprintPart {
  name: string;
  shape: PartShape;
  size: Vec3Tuple;
  position: Vec3Tuple;
  rotationDeg?: Vec3Tuple;
  tessellation?: number;
  /** Colour slot, resolved through the model variant to a palette key. */
  color: string;
  /** Self-illumination as a fraction of the colour (added to `material.baseEmissive`). */
  emissive?: number;
  alpha?: number;
  /** Moving sub-assembly this part belongs to (pivot in `groups`). */
  group?: string;
}

export interface Blueprint {
  category: ModelCategory;
  defaultVariant: string;
  variants: Record<string, Record<string, string>>;
  /** Pivot of each movable group in model space. */
  groups?: Record<string, Vec3Tuple>;
  /** Group → the group it hangs from (limb chains: shoulder → elbow); groups without an entry hang from the root. */
  groupParents?: Record<string, string>;
  /** Named points in model space. */
  anchors?: Record<string, Vec3Tuple>;
  /** Anchor → the group it moves with (a muzzle on a forearm); anchors without an entry hang from the root. */
  anchorParents?: Record<string, string>;
  parts: BlueprintPart[];
}

export interface ModelsData {
  budgets: Record<ModelCategory, number>;
  material: { maxSimultaneousLights: number; baseEmissive: number };
  blueprints: Record<string, Blueprint>;
}

const triangles = Schema.integer({ min: 1 });

/** Typed loader for `data/models.json`: triangle budgets per category, shared material settings and blueprints. */
export class ModelBlueprints {
  static readonly file = "data/models.json";

  static readonly schema = Schema.object({
    budgets: Schema.object(Object.fromEntries(MODEL_CATEGORIES.map((c) => [c, triangles]))),
    material: Schema.object({
      maxSimultaneousLights: Schema.integer({ min: 1, max: 32 }),
      baseEmissive: Schema.number({ min: 0, max: 1 }),
    }),
    blueprints: Schema.record(
      Schema.object(
        {
          category: Schema.enumOf(MODEL_CATEGORIES),
          defaultVariant: Schema.string(),
          variants: Schema.record(Schema.record(Schema.paletteRef())),
          groups: Schema.record(Schema.vec3()),
          groupParents: Schema.record(Schema.string()),
          anchors: Schema.record(Schema.vec3()),
          anchorParents: Schema.record(Schema.string()),
          parts: Schema.array(
            Schema.object(
              {
                name: Schema.string(),
                shape: Schema.enumOf(PART_SHAPES),
                size: Schema.vec3(),
                position: Schema.vec3(),
                rotationDeg: Schema.vec3(),
                tessellation: Schema.integer({ min: 3, max: 32 }),
                color: Schema.string(),
                emissive: Schema.number({ min: 0, max: 4 }),
                alpha: Schema.number({ min: 0, max: 1 }),
                group: Schema.string(),
              },
              ["rotationDeg", "tessellation", "emissive", "alpha", "group"],
            ),
            1,
          ),
        },
        ["groups", "groupParents", "anchors", "anchorParents"],
      ),
    ),
  });

  private static cached: ModelsData | null = null;

  static load(): ModelsData {
    if (ModelBlueprints.cached === null) {
      const data = DataLoader.parse<ModelsData>(ModelBlueprints.file, modelsJson, ModelBlueprints.schema);
      ModelBlueprints.validate(data);
      ModelBlueprints.cached = data;
    }
    return ModelBlueprints.cached;
  }

  static blueprint(name: string): Blueprint {
    const blueprint = ModelBlueprints.load().blueprints[name];
    if (blueprint === undefined || name.startsWith("//")) throw new Error(`${ModelBlueprints.file}: no blueprint "${name}"`);
    return blueprint;
  }

  /**
   * Cross-field checks: every part's colour slot exists in each variant, every part group has a pivot, group and anchor
   * parents are groups and group parents form no cycle.
   */
  private static validate(data: ModelsData): void {
    for (const [name, blueprint] of Object.entries(data.blueprints)) {
      if (name.startsWith("//")) continue;
      const where = `${ModelBlueprints.file}: blueprints.${name}`;
      if (blueprint.variants[blueprint.defaultVariant] === undefined) {
        throw new Error(`${where}.defaultVariant "${blueprint.defaultVariant}" is not a variant`);
      }
      for (const part of blueprint.parts) {
        for (const [variantName, slots] of Object.entries(blueprint.variants)) {
          if (slots[part.color] === undefined) throw new Error(`${where}: variant "${variantName}" has no colour for slot "${part.color}" (part ${part.name})`);
        }
        if (part.group !== undefined && blueprint.groups?.[part.group] === undefined) {
          throw new Error(`${where}: part ${part.name} uses group "${part.group}" without a pivot in groups`);
        }
      }
      const groups = blueprint.groups ?? {};
      const parents = blueprint.groupParents ?? {};
      for (const [group, parent] of Object.entries(parents)) {
        if (group.startsWith("//")) continue;
        if (groups[group] === undefined || groups[parent] === undefined) throw new Error(`${where}.groupParents: ${group} → ${parent} must name groups`);
        const seen = new Set<string>([group]);
        for (let up: string | undefined = parent; up !== undefined; up = parents[up]) {
          if (seen.has(up)) throw new Error(`${where}.groupParents: cycle through "${up}"`);
          seen.add(up);
        }
      }
      for (const [anchor, parent] of Object.entries(blueprint.anchorParents ?? {})) {
        if (anchor.startsWith("//")) continue;
        if (blueprint.anchors?.[anchor] === undefined || groups[parent] === undefined) {
          throw new Error(`${where}.anchorParents: ${anchor} → ${parent} must name an anchor and a group`);
        }
      }
    }
  }
}
