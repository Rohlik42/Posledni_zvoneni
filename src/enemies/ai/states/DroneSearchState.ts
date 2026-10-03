import { State } from "yuka";
import type { DroneAgent } from "../DroneAgent";

/**
 * Lost the player: wanders around the last known spot (within `search.radius`) for `search.duration`, then back to
 * Patrol. Seeing the player → Attack or Chase; hearing or being hit → Alert.
 */
export class DroneSearchState extends State<DroneAgent> {
  override enter(agent: DroneAgent): void {
    agent.face(null);
    const known = agent.perception.lastKnownPosition;
    if (known !== null) agent.home.set(known.x, agent.position.y, known.z);
  }

  override execute(agent: DroneAgent): void {
    if (agent.perception.seesPlayer) {
      agent.changeState(agent.engageState());
      return;
    }
    if (agent.heard || agent.hurt) {
      agent.changeState("alert");
      return;
    }
    if (agent.stateTime >= agent.data.search.duration) {
      agent.changeState("patrol");
      return;
    }
    agent.wanderAround(agent.home, agent.data.search.radius);
  }
}
