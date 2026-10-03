import { State } from "yuka";
import type { DroneAgent } from "../DroneAgent";

/** Stunned: rotors stall, the drone sinks to `stun.height` and wobbles; afterwards it engages or patrols. */
export class DroneStunnedState extends State<DroneAgent> {
  override enter(agent: DroneAgent): void {
    agent.face(null);
    agent.body.cancelWindup();
  }

  override execute(agent: DroneAgent): void {
    if (agent.body.stunned) return;
    agent.changeState(agent.perception.remembersPlayer ? agent.engageState() : "patrol");
  }
}
