import { State } from "yuka";
import type { HumanoidAgent } from "../HumanoidAgent";

/**
 * Runs along the navmesh towards the player (live position while seen, otherwise the last known one, re-pathed as it
 * moves). Seen within attack range → Attack; reached the last known spot without seeing the player, lost the memory
 * or no path → Search. Crossing a cover health threshold → Cover.
 */
export class ChaseState extends State<HumanoidAgent> {
  override enter(agent: HumanoidAgent): void {
    agent.face(null);
    const target = this.target(agent);
    if (target !== null) agent.moveTo(target, "run", true);
  }

  override execute(agent: HumanoidAgent): void {
    if (agent.coverDue()) {
      agent.changeState("cover");
      return;
    }
    const sees = agent.perception.seesPlayer;
    if (sees && agent.distanceToTarget() <= agent.data.attack.range) {
      agent.changeState("attack");
      return;
    }
    const target = this.target(agent);
    if (target === null || !agent.perception.remembersPlayer) {
      agent.changeState("search");
      return;
    }
    agent.moveTo(target, "run");
    if (agent.noPath || (!sees && agent.arrived)) agent.changeState("search");
  }

  private target(agent: HumanoidAgent) {
    return agent.perception.seesPlayer ? agent.target.feet : agent.perception.lastKnownPosition;
  }
}
