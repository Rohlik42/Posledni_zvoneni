import { State } from "yuka";
import type { DroneAgent } from "../DroneAgent";

/** Something was sensed: the drone stops, turns towards it for `senses.alertTime`, then attacks or chases. */
export class DroneAlertState extends State<DroneAgent> {
  override enter(agent: DroneAgent): void {
    agent.hold();
  }

  override execute(agent: DroneAgent): void {
    agent.face(agent.perception.lastKnownPosition);
    if (agent.stateTime < agent.data.senses.alertTime) return;
    agent.changeState(agent.engageState());
  }
}
