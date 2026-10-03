import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { State } from "yuka";
import type { QuadrupedAgent } from "../QuadrupedAgent";

const DEG_TO_RAD = Math.PI / 180;
/** The orbit target leads the robot by this much time of angular travel (s), so the seek pulls it along the circle. */
const ORBIT_LEAD = 0.5;
/** Leaves the circle for a sprint when the player gets this much farther than `engageDistance`. */
const LEAVE_FACTOR = 1.3;
/** Moving slower than this share of the circling speed counts as stuck (against a pillar). */
const STUCK_SPEED_SHARE = 0.25;

/**
 * Circles the player (DESIGN §5 "obíhá hráče") with Yuka steering: every step it seeks a point on a circle of
 * `circle.radius` around the player, a little ahead of its own bearing in the chosen direction, while it keeps facing
 * the player. Blocked by a pillar for `stuckTime` → turns round. After `circle.time` (seeded) with the player in sight
 * and within `lunge.range` → Lunge. Player unseen for `loseSightTime` or far away → Chase.
 */
export class CircleState extends State<QuadrupedAgent> {
  private direction = 1;
  private duration = 0;
  private unseen = 0;
  private stuck = 0;
  private readonly lastFeet = new Vector3();

  override enter(agent: QuadrupedAgent): void {
    const { circle } = agent.data;
    this.direction = agent.random.next() < 0.5 ? -1 : 1;
    this.duration = agent.random.range(circle.time[0], circle.time[1]);
    this.unseen = 0;
    this.stuck = 0;
    this.lastFeet.copyFrom(agent.feet);
  }

  override execute(agent: QuadrupedAgent): void {
    const { circle, lunge } = agent.data;
    const sees = agent.perception.seesPlayer;
    this.unseen = sees ? 0 : this.unseen + agent.dt;
    const distance = agent.distanceToTarget();
    if (this.unseen >= circle.loseSightTime || (sees && distance > circle.engageDistance * LEAVE_FACTOR)) {
      agent.changeState("chase");
      return;
    }
    if (agent.stateTime >= this.duration && sees && distance <= lunge.range) {
      agent.changeState("lunge");
      return;
    }

    const player = agent.target.feet;
    const feet = agent.feet;
    const bearing = Math.atan2(feet.x - player.x, feet.z - player.z);
    const angle = bearing + this.direction * circle.angularSpeedDeg * DEG_TO_RAD * ORBIT_LEAD;
    const point = new Vector3(player.x + Math.sin(angle) * circle.radius, feet.y, player.z + Math.cos(angle) * circle.radius);
    agent.steerTo(point, circle.speed);
    agent.face(player);

    const moved = Math.hypot(feet.x - this.lastFeet.x, feet.z - this.lastFeet.z);
    this.lastFeet.copyFrom(feet);
    const slowest = circle.speed * agent.body.speedFactor * STUCK_SPEED_SHARE * agent.dt;
    this.stuck = moved < slowest ? this.stuck + agent.dt : 0;
    if (this.stuck >= circle.stuckTime) {
      this.direction = -this.direction;
      this.stuck = 0;
    }
  }

  override exit(agent: QuadrupedAgent): void {
    agent.stop();
    agent.face(null);
  }
}
