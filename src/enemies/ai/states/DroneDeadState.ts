import { State } from "yuka";
import type { DroneAgent } from "../DroneAgent";

/** Destroyed: the drone's parts fall as debris (`Drone`); the agent does nothing. */
export class DroneDeadState extends State<DroneAgent> {
  override enter(agent: DroneAgent): void {
    agent.face(null);
    agent.body.cancelWindup();
    agent.velocity.set(0, 0, 0);
  }

  override execute(_agent: DroneAgent): void {}
}
