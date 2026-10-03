import { State } from "yuka";
import type { GroundAgent } from "../GroundAgent";

/** Destroyed: no movement, no senses acted on. The body falls apart (`Humanoid`). */
export class DeadState extends State<GroundAgent> {
  override enter(agent: GroundAgent): void {
    agent.stop();
    agent.face(null);
    agent.body.cancelWindup();
    agent.context.cover.release(agent);
  }

  override execute(_agent: GroundAgent): void {}
}
