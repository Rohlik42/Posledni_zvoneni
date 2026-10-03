import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { State } from "yuka";
import type { QuadrupedAgent } from "../QuadrupedAgent";

type LungePhase = "windup" | "leap" | "recover";

/**
 * The quadruped's melee attack (DESIGN §5 "výpad"): it stops and crouches for `lunge.windup` facing the player
 * (telegraph), then leaps — a Yuka seek at `lunge.speed` towards where the player stood plus `overshoot` — biting once
 * when its jaws reach the player; after `maxTime` or on arrival it recovers for `lunge.recover`, then circles again
 * (or chases a player it cannot see).
 */
export class LungeState extends State<QuadrupedAgent> {
  private phase: LungePhase = "windup";
  private time = 0;

  override enter(agent: QuadrupedAgent): void {
    agent.stop();
    agent.face(agent.target.feet);
    agent.body.startWindup();
    this.phase = "windup";
    this.time = 0;
  }

  override execute(agent: QuadrupedAgent): void {
    const { lunge } = agent.data;
    this.time += agent.dt;
    switch (this.phase) {
      case "windup":
        agent.face(agent.target.feet);
        if (agent.body.updateWindup(agent.dt)) this.leap(agent);
        return;
      case "leap":
        agent.body.tryBite();
        if (agent.arrived || !agent.moving || this.time >= lunge.maxTime) {
          agent.body.endLeap();
          agent.stop();
          this.phase = "recover";
          this.time = 0;
        }
        return;
      case "recover":
        agent.face(agent.target.feet);
        if (this.time >= lunge.recover) agent.changeState(agent.perception.seesPlayer ? "circle" : "chase");
        return;
    }
  }

  override exit(agent: QuadrupedAgent): void {
    agent.body.cancelWindup();
    agent.body.endLeap();
    agent.face(null);
  }

  private leap(agent: QuadrupedAgent): void {
    const { lunge } = agent.data;
    const feet = agent.feet;
    const player = agent.target.feet;
    const direction = new Vector3(player.x - feet.x, 0, player.z - feet.z);
    if (direction.lengthSquared() < Number.EPSILON) direction.set(Math.sin(agent.yaw), 0, Math.cos(agent.yaw));
    direction.normalize();
    const target = new Vector3(player.x, feet.y, player.z).addInPlace(direction.scale(lunge.overshoot));
    agent.steerTo(target, lunge.speed, lunge.acceleration);
    agent.face(target);
    agent.body.startLeap();
    this.phase = "leap";
    this.time = 0;
  }
}
