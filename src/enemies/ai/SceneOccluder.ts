import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GameEntity, type Ray as YukaRay, type Vector3 as YukaVector3 } from "yuka";
import type { LineOfSight } from "./LineOfSight";

/**
 * The whole rendered scene as one obstacle for Yuka's `Vision`: Yuka asks every obstacle for the point where the view
 * ray hits it, and this answers with a raycast into the Babylon scene (`LineOfSight`), limited to the vision range.
 */
export class SceneOccluder extends GameEntity {
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();

  constructor(
    private readonly lineOfSight: LineOfSight,
    private readonly range: number,
  ) {
    super();
  }

  override lineOfSightTest(ray: YukaRay, intersectionPoint: YukaVector3): YukaVector3 | null {
    this.origin.set(ray.origin.x, ray.origin.y, ray.origin.z);
    this.direction.set(ray.direction.x, ray.direction.y, ray.direction.z);
    const distance = this.lineOfSight.firstHit(this.origin, this.direction, this.range);
    if (distance === null) return null;
    intersectionPoint.copy(ray.direction).multiplyScalar(distance).add(ray.origin);
    return intersectionPoint;
  }
}
