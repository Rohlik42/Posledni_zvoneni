import physicsJson from "../../data/physics.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";
import type { Vec3Tuple } from "./GameConfig";

export interface PhysicsData {
  gravity: Vec3Tuple;
  staticFriction: number;
  restitution: number;
}

/** Typed loader for `data/physics.json`. */
export class PhysicsConfig {
  static readonly file = "data/physics.json";

  static readonly schema = Schema.object({
    gravity: Schema.vec3(),
    staticFriction: Schema.number({ min: 0 }),
    restitution: Schema.number({ min: 0, max: 1 }),
  });

  static load(): PhysicsData {
    return DataLoader.parse<PhysicsData>(PhysicsConfig.file, physicsJson, PhysicsConfig.schema);
  }
}
