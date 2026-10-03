import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { State } from "yuka";
import { Random } from "../../../utils/Random";
import type { GroundAgent } from "../GroundAgent";

/**
 * The player got away: walk to the last known position, then visit random navmesh points within `search.radius`
 * (seeded), pausing `search.pauseTime` at each, for `search.duration` seconds; then back to Patrol. Seeing the player
 * → Attack or Chase; hearing or being hit → Alert.
 */
export class SearchState extends State<GroundAgent> {
  private center = Vector3.Zero();
  private paused = 0;
  private random: Random | null = null;

  override enter(agent: GroundAgent): void {
    this.random ??= new Random(agent.data.search.seed);
    this.center = (agent.perception.lastKnownPosition ?? agent.feet).clone();
    this.paused = 0;
    agent.face(null);
    agent.moveTo(this.center, "walk", true);
  }

  override execute(agent: GroundAgent): void {
    const { search } = agent.data;
    if (agent.perception.seesPlayer) {
      agent.changeState(agent.engageState());
      return;
    }
    if (agent.heard || agent.hurt) {
      agent.changeState("alert");
      return;
    }
    if (agent.stateTime >= search.duration) {
      agent.changeState("patrol");
      return;
    }
    if (!agent.arrived && !agent.noPath && agent.moving) return;
    this.paused += agent.dt;
    if (this.paused < search.pauseTime) return;
    this.paused = 0;
    const random = this.random!;
    const angle = random.range(0, Math.PI * 2);
    const distance = random.range(0, search.radius);
    const spot = this.center.add(new Vector3(Math.sin(angle) * distance, 0, Math.cos(angle) * distance));
    agent.moveTo(spot, "walk", true);
  }
}
