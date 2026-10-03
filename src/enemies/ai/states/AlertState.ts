import { State } from "yuka";
import type { GroundAgent } from "../GroundAgent";

/**
 * Something was seen, heard or felt: the robot stops and turns towards it for `senses.alertTime`, then engages
 * (`engageState`: a humanoid attacks a visible player in range, otherwise every robot chases the last known position).
 */
export class AlertState extends State<GroundAgent> {
  override enter(agent: GroundAgent): void {
    agent.stop();
  }

  override execute(agent: GroundAgent): void {
    agent.face(agent.perception.lastKnownPosition);
    if (agent.stateTime < agent.data.senses.alertTime) return;
    agent.changeState(agent.engageState());
  }
}
