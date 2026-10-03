import { State } from "yuka";
import type { DroneAgent } from "../DroneAgent";
import { DroneChaseState } from "./DroneChaseState";

/** Leaves the attack when the player is this much farther than the attack range. */
const RANGE_HYSTERESIS = 1.15;
/** Winds up only when facing the player within this angle (radians). */
const MAX_FIRE_ANGLE = 0.4;
/** The drone aims at the player's chest, this far below the eyes (m). */
const CHEST_BELOW_EYES = 0.4;

/**
 * Hovers `attack.preferredDistance` from the player, faces him and zaps: after `cooldown` (first after
 * `firstShotDelay`) the zapper winds up for `attack.windup` (charge orb) and fires a weak bolt. Player unseen for
 * `loseSightTime` or out of range → Chase.
 */
export class DroneAttackState extends State<DroneAgent> {
  private cooldown = 0;
  private unseen = 0;

  override enter(agent: DroneAgent): void {
    this.cooldown = agent.data.attack.firstShotDelay;
    this.unseen = 0;
  }

  override execute(agent: DroneAgent): void {
    const { attack, flight } = agent.data;
    const aim = agent.aimPoint(CHEST_BELOW_EYES);
    if (aim !== null) agent.face(aim);
    const sees = agent.perception.seesPlayer;
    this.unseen = sees ? 0 : this.unseen + agent.dt;
    agent.flyTo(DroneChaseState.standoff(agent, agent.context.target.feet, attack.preferredDistance), flight.chaseSpeed);
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

  override exit(agent: DroneAgent): void {
    agent.body.cancelWindup();
    agent.face(null);
  }
}
