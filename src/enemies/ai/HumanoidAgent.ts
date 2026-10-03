import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { HumanoidData } from "../EnemyConfig";
import type { AiStateId } from "./AiStateIds";
import { GroundAgent, type AgentContext, type GroundBody } from "./GroundAgent";
import { AlertState } from "./states/AlertState";
import { AttackState } from "./states/AttackState";
import { ChaseState } from "./states/ChaseState";
import { CoverState } from "./states/CoverState";
import { DeadState } from "./states/DeadState";
import { PatrolState } from "./states/PatrolState";
import { SearchState } from "./states/SearchState";
import { StunnedState } from "./states/StunnedState";

export type { AgentContext, StateChange } from "./GroundAgent";

/** What the humanoid AI needs from the robot body it drives (implemented by `Humanoid`). */
export interface AgentBody extends GroundBody {
  readonly windingUp: boolean;
  /** Starts the cannon wind-up (telegraph). */
  startWindup(): void;
  /** Advances the wind-up; fires at `aimPoint` and returns true when it completes. */
  updateWindup(dt: number, aimPoint: Vector3): boolean;
}

/**
 * The humanoid's brain (a `GroundAgent`): Patrol → Alert → Chase → Attack ↔ Cover → Search → Patrol, Stunned, Dead.
 * It shoots from a distance (`attack.range`) and runs for cover at the health thresholds of `cover`.
 */
export class HumanoidAgent extends GroundAgent {
  declare readonly data: HumanoidData;
  declare readonly body: AgentBody;

  private coverIndex = 0;
  private readonly coverState = new CoverState();

  constructor(data: HumanoidData, context: AgentContext, body: AgentBody, spawn: Vector3, yaw: number, patrolRoute: readonly Vector3[]) {
    super(data, context, body, spawn, yaw, patrolRoute);
    this.fsm.add("patrol", new PatrolState());
    this.fsm.add("alert", new AlertState());
    this.fsm.add("chase", new ChaseState());
    this.fsm.add("attack", new AttackState());
    this.fsm.add("cover", this.coverState);
    this.fsm.add("search", new SearchState());
    this.fsm.add("stunned", new StunnedState());
    this.fsm.add("dead", new DeadState());
    this.changeState("patrol");
  }

  /** Cover point the robot runs to or hides at, null outside the Cover state. */
  get coverId(): string | null {
    return this.coverState.coverId;
  }

  /** Shoots a seen player within `attack.range`, otherwise chases. */
  engageState(): AiStateId {
    return this.perception.seesPlayer && this.distanceToTarget() <= this.data.attack.range ? "attack" : "chase";
  }

  /** True once per health threshold in `cover.healthThresholds` crossed since the last call (time to take cover). */
  coverDue(): boolean {
    const thresholds = this.data.cover.healthThresholds;
    let due = false;
    while (this.coverIndex < thresholds.length && this.body.healthFraction <= thresholds[this.coverIndex]!) {
      this.coverIndex++;
      due = true;
    }
    return due;
  }

  /** Where to aim at the player: the chest (eyes minus `chestBelowEyes`), live when seen, else the last known spot. */
  aimPoint(chestBelowEyes: number): Vector3 | null {
    const source = this.perception.seesPlayer ? this.context.target.eye : this.perception.lastKnownPosition;
    return source === null ? null : new Vector3(source.x, source.y - chestBelowEyes, source.z);
  }

  protected override onReset(): void {
    this.coverIndex = 0;
    this.context.cover.release(this);
  }
}
