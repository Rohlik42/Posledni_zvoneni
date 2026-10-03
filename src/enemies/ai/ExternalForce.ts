import { SteeringBehavior, Vector3 as YukaVector3, type Vehicle } from "yuka";

/**
 * A steering force computed outside Yuka each step (the drone's raycast wall avoidance and its altitude spring), so
 * it takes part in the steering manager's prioritised force budget like any Yuka behaviour.
 */
export class ExternalForce extends SteeringBehavior {
  readonly value = new YukaVector3();

  override calculate(_vehicle: Vehicle, force: YukaVector3): YukaVector3 {
    return force.copy(this.value);
  }
}
