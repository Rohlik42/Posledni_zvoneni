import { SteeringBehavior, Vector3 as YukaVector3, type Vehicle } from "yuka";
import type { Random } from "../../utils/Random";

/**
 * Yuka wander with seeded randomness (Yuka's own `WanderBehavior` uses `Math.random`, which would make the drone's
 * patrol differ in every test run): a target jitters on a circle of `radius` projected `distance` ahead of the vehicle
 * (in the frame of its heading `yaw`) and the vehicle steers towards it. Horizontal only; altitude is the hover's job.
 */
export class SeededWander extends SteeringBehavior {
  private readonly targetLocal = new YukaVector3();

  constructor(
    private readonly random: Random,
    public radius: number,
    public distance: number,
    public jitter: number,
    private readonly heading: () => number,
  ) {
    super();
    const angle = random.range(0, Math.PI * 2);
    this.targetLocal.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
  }

  override calculate(vehicle: Vehicle, force: YukaVector3, delta: number): YukaVector3 {
    const jitter = this.jitter * delta;
    this.targetLocal.x += this.random.range(-1, 1) * jitter;
    this.targetLocal.z += this.random.range(-1, 1) * jitter;
    this.targetLocal.y = 0;
    if (this.targetLocal.squaredLength() < Number.EPSILON) this.targetLocal.set(0, 0, 1);
    this.targetLocal.normalize().multiplyScalar(this.radius);
    // Local (right = x, forward = z) → world with the heading yaw (0 = +z).
    const yaw = this.heading();
    const lx = this.targetLocal.x;
    const lz = this.targetLocal.z + this.distance;
    const wx = lx * Math.cos(yaw) + lz * Math.sin(yaw);
    const wz = -lx * Math.sin(yaw) + lz * Math.cos(yaw);
    force.set(wx, 0, wz);
    return force;
  }
}
