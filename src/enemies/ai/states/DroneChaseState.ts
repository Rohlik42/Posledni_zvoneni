import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { State } from "yuka";
import type { DroneAgent } from "../DroneAgent";

/**
 * Flies at `flight.chaseSpeed` towards the player: while seen to a point `attack.preferredDistance` short of him (it
 * never rams him), otherwise to the last known spot. Seen within `attack.range` → Attack; memory gone or the last known
 * spot reached without seeing the player → Search.
 */
export class DroneChaseState extends State<DroneAgent> {
  override enter(agent: DroneAgent): void {
    agent.face(null);
  }

  override execute(agent: DroneAgent): void {
    const { attack, flight } = agent.data;
    const sees = agent.perception.seesPlayer;
    if (sees && agent.distanceToTarget() <= attack.range) {
      agent.changeState("attack");
      return;
    }
    const known = agent.perception.lastKnownPosition;
    if (!agent.perception.remembersPlayer || known === null) {
      agent.changeState("search");
      return;
    }
    if (sees) {
      agent.flyTo(DroneChaseState.standoff(agent, agent.context.target.feet, attack.preferredDistance), flight.chaseSpeed);
      return;
    }
    agent.flyTo(known, flight.chaseSpeed);
    if (agent.arrived) agent.changeState("search");
  }

  /** The point `distance` from `target` on the line towards the drone (horizontal). */
  static standoff(agent: DroneAgent, target: Vector3, distance: number): Vector3 {
    const away = new Vector3(agent.position.x - target.x, 0, agent.position.z - target.z);
    if (away.lengthSquared() < Number.EPSILON) away.set(Math.sin(agent.yaw), 0, Math.cos(agent.yaw));
    away.normalize().scaleInPlace(distance);
    return new Vector3(target.x + away.x, agent.position.y, target.z + away.z);
  }
}
