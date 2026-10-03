import { State } from "yuka";
import type { HumanoidAgent } from "../HumanoidAgent";

/** Leaves the attack when the player is this much farther than the attack range (no flicker at the edge). */
const RANGE_HYSTERESIS = 1.15;
/** Starts a wind-up only when facing the player within this angle (radians). */
const MAX_FIRE_ANGLE = 0.35;
/** The robot aims at the player's chest, this far below the eyes (m). */
const CHEST_BELOW_EYES = 0.4;

/**
 * Stands, turns to the player and fires electric bolts: after `cooldown` (first shot after `firstShotDelay`) the cannon
 * winds up for `attack.windup` seconds (charge orb = telegraph) and fires. Player out of sight for `loseSightTime` or
 * out of range → Chase; health under a cover threshold → Cover.
 */
export class AttackState extends State<HumanoidAgent> {
  private cooldown = 0;
  private unseen = 0;

  override enter(agent: HumanoidAgent): void {
    agent.stop();
    this.cooldown = agent.data.attack.firstShotDelay;
    this.unseen = 0;
  }

  override execute(agent: HumanoidAgent): void {
    const { attack } = agent.data;
    const aim = agent.aimPoint(CHEST_BELOW_EYES);
    if (aim !== null) agent.face(aim);
    if (agent.coverDue()) {
      agent.changeState("cover");
      return;
    }
    const sees = agent.perception.seesPlayer;
    this.unseen = sees ? 0 : this.unseen + agent.dt;
    if (agent.body.windingUp) {
      if (aim !== null && agent.body.updateWindup(agent.dt, aim)) this.cooldown = attack.cooldown;
      return;
    }
    if (this.unseen >= attack.loseSightTime || (sees && agent.distanceToTarget() > attack.range * RANGE_HYSTERESIS)) {
      agent.changeState("chase");
      return;
    }
    this.cooldown -= agent.dt;
    if (this.cooldown <= 0 && sees && aim !== null && agent.facingError(aim) <= MAX_FIRE_ANGLE) agent.body.startWindup();
  }

  override exit(agent: HumanoidAgent): void {
    agent.body.cancelWindup();
    agent.face(null);
  }
}
