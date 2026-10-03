import { State } from "yuka";
import type { HumanoidAgent } from "../HumanoidAgent";

/**
 * Stunned (`Enemy.applyStatus("stun")`, the taser of phase 13): stands still, no wind-up, twitching; when the stun
 * wears off it goes for the player it remembers (Attack or Chase) or back to Patrol.
 */
export class StunnedState extends State<HumanoidAgent> {
  override enter(agent: HumanoidAgent): void {
    agent.stop();
    agent.face(null);
    agent.body.cancelWindup();
  }

  override execute(agent: HumanoidAgent): void {
    if (agent.body.stunned) return;
    if (!agent.perception.remembersPlayer) {
      agent.changeState("patrol");
      return;
    }
    const inRange = agent.distanceToTarget() <= agent.data.attack.range;
    agent.changeState(agent.perception.seesPlayer && inRange ? "attack" : "chase");
  }
}
