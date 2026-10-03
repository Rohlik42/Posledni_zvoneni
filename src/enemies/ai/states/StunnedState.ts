import { State } from "yuka";
import type { GroundAgent } from "../GroundAgent";

/**
 * Stunned (`Enemy.applyStatus("stun")`, the taser of phase 13): stands still, no wind-up, twitching; when the stun
 * wears off it goes for the player it remembers (Attack or Chase) or back to Patrol.
 */
export class StunnedState extends State<GroundAgent> {
  override enter(agent: GroundAgent): void {
    agent.stop();
    agent.face(null);
    agent.body.cancelWindup();
  }

  override execute(agent: GroundAgent): void {
    if (agent.body.stunned) return;
    if (!agent.perception.remembersPlayer) {
      agent.changeState("patrol");
      return;
    }
    agent.changeState(agent.engageState());
  }
}
