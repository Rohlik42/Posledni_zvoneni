import { State } from "yuka";
import type { DroneAgent } from "../DroneAgent";

/** Wanders (seeded Yuka wander) around its spawn within `flight.homeRadius`; anything noticed → Alert. */
export class DronePatrolState extends State<DroneAgent> {
  override enter(agent: DroneAgent): void {
    agent.face(null);
    agent.home.copyFrom(agent.spawn);
  }

  override execute(agent: DroneAgent): void {
    if (agent.noticed) {
      agent.changeState("alert");
      return;
    }
    agent.wanderAround(agent.home, agent.data.flight.homeRadius);
  }
}
