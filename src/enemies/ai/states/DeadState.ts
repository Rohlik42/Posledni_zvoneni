import { State } from "yuka";
import type { HumanoidAgent } from "../HumanoidAgent";

/** Destroyed: no movement, no senses acted on. The body falls apart (`Humanoid`). */
export class DeadState extends State<HumanoidAgent> {
  override enter(agent: HumanoidAgent): void {
    agent.stop();
    agent.face(null);
    agent.body.cancelWindup();
    agent.context.cover.release(agent);
  }

  override execute(_agent: HumanoidAgent): void {}
}
