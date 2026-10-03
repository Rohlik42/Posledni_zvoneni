import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Random } from "../../utils/Random";
import type { QuadrupedData } from "../EnemyConfig";
import type { AiStateId } from "./AiStateIds";
import { GroundAgent, type AgentContext, type GroundBody } from "./GroundAgent";
import { AlertState } from "./states/AlertState";
import { CircleState } from "./states/CircleState";
import { DeadState } from "./states/DeadState";
import { LungeState } from "./states/LungeState";
import { PatrolState } from "./states/PatrolState";
import { RushState } from "./states/RushState";
import { SearchState } from "./states/SearchState";
import { StunnedState } from "./states/StunnedState";

/** What the quadruped AI needs from its body (implemented by `Quadruped`). */
export interface QuadrupedBody extends GroundBody {
  readonly windingUp: boolean;
  /** Starts the crouch before a lunge (telegraph). */
  startWindup(): void;
  /** Advances the crouch; true when it is complete and the leap should start. */
  updateWindup(dt: number): boolean;
  /** The leap begins (jaw open, lunge sound). */
  startLeap(): void;
  /** During the leap: bites the player once when the jaws reach him; true on the step it bit. */
  tryBite(): boolean;
  /** The leap is over. */
  endLeap(): void;
}

/**
 * The quadruped's brain (a `GroundAgent`): Patrol → Alert → Chase (sprint along the navmesh, `RushState`) → Circle (Yuka
 * seek around the player) → Lunge (crouch, leap, bite, recover) → Circle …; Search when the player is lost, Stunned,
 * Dead. Its seeded `random` picks the circling direction and time.
 */
export class QuadrupedAgent extends GroundAgent {
  declare readonly data: QuadrupedData;
  declare readonly body: QuadrupedBody;
  readonly random: Random;

  constructor(data: QuadrupedData, context: AgentContext, body: QuadrupedBody, spawn: Vector3, yaw: number, patrolRoute: readonly Vector3[], seed: number) {
    super(data, context, body, spawn, yaw, patrolRoute);
    this.random = new Random(seed);
    this.fsm.add("patrol", new PatrolState());
    this.fsm.add("alert", new AlertState());
    this.fsm.add("chase", new RushState());
    this.fsm.add("circle", new CircleState());
    this.fsm.add("lunge", new LungeState());
    this.fsm.add("search", new SearchState());
    this.fsm.add("stunned", new StunnedState());
    this.fsm.add("dead", new DeadState());
    this.changeState("patrol");
  }

  /** A melee robot always closes in first. */
  engageState(): AiStateId {
    return "chase";
  }
}
