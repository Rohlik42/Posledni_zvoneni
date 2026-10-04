import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { StationPlacement } from "../weapons/ExtinguisherRefill";
import type { StationPlacements } from "../weapons/WeaponStations";
import { LevelLayout } from "./LevelLayout";
import type { ProgressionData } from "./ProgressionConfig";

/** `level.json → pickups[].item` of a wall extinguisher (refills an owned weapon 2). */
const REFILL_ITEM = "extinguisher-refill";
/** Level geometry meshes are named `level:<room>:<material>`. */
const LEVEL_MESH_PREFIX = "level:";
const PROBE_DIRECTIONS = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];

/**
 * Where the level's weapon stations stand (phase 16): `level.json → pickups` with the items that `pickups.json` lists as
 * `external` — wall extinguishers along the corridors. The level gives a
 * point near a wall; the station is put against the nearest wall that a horizontal ray finds (the real inner face,
 * which depends on how thick the wall was built) and turned to face into the room (models face +z).
 */
export class LevelStations {
  static placements(scene: Scene, layout: LevelLayout, data: ProgressionData["stations"]): StationPlacements {
    const refills: StationPlacement[] = [];
    for (const pickup of layout.level.pickups) {
      if (pickup.item !== REFILL_ITEM) continue;
      const floorY = layout.floorY(layout.room(pickup.room));
      const p = LevelLayout.toWorld(pickup.x, floorY, pickup.z);
      const placement = LevelStations.againstWall(scene, pickup.id, new Vector3(p.x, p.y, p.z), data);
      refills.push(placement);
    }
    return { refills, ammoPickups: [] };
  }

  /** Puts the station `wallGap` in front of the nearest wall within `probeDistance`, facing away from it. */
  private static againstWall(scene: Scene, id: string, point: Vector3, data: ProgressionData["stations"]): StationPlacement {
    const origin = point.add(new Vector3(0, data.probeHeight, 0));
    const isLevel = (mesh: AbstractMesh): boolean => mesh.isVisible && mesh.name.startsWith(LEVEL_MESH_PREFIX);
    let best: { distance: number; normal: Vector3 } | null = null;
    for (const direction of PROBE_DIRECTIONS) {
      const pick = scene.pickWithRay(new Ray(origin, direction, data.probeDistance), isLevel);
      if (pick?.hit !== true || (best !== null && pick.distance >= best.distance)) continue;
      // Face away from the wall: the reverse of the probe direction (walls are axis-aligned).
      best = { distance: pick.distance, normal: direction.scale(-1) };
    }
    if (best === null) return { id, position: [point.x, point.y, point.z], yaw: 0 };
    const at = point.add(best.normal.scale(data.wallGap - best.distance));
    return { id, position: [at.x, point.y, at.z], yaw: Math.atan2(best.normal.x, best.normal.z) };
  }
}
