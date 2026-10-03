import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { State } from "yuka";
import type { QuadrupedAgent } from "../QuadrupedAgent";

/**
 * The quadruped's chase: sprints (`movement.runSpeed`) along the navmesh towards the player (live while seen, else the
 * last known spot). Seen within `circle.engageDistance` → Circle; lost memory, no path or reached the last known spot
 * without seeing the player → Search.
 */
export class RushState extends State<QuadrupedAgent> {
  override enter(agent: QuadrupedAgent): void {
    agent.face(null);
    const target = RushState.target(agent);
    if (target !== null) agent.moveTo(target, "run", true);
  }

  override execute(agent: QuadrupedAgent): void {
    const sees = agent.perception.seesPlayer;
    if (sees && agent.distanceToTarget() <= agent.data.circle.engageDistance) {
      agent.changeState("circle");
      return;
    }
    const target = RushState.target(agent);
    if (target === null || !agent.perception.remembersPlayer) {
      agent.changeState("search");
      return;
    }
    agent.moveTo(target, "run");
    if (agent.noPath || (!sees && agent.arrived)) agent.changeState("search");
  }

  private static target(agent: QuadrupedAgent): Vector3 | null {
    return agent.perception.seesPlayer ? agent.target.feet : agent.perception.lastKnownPosition;
  }
}
