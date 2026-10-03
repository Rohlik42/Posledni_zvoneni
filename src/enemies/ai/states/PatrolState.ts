import { State } from "yuka";
import type { GroundAgent } from "../GroundAgent";

/** Walks the patrol route in a loop, pausing `patrol.waitTime` at each point; anything noticed → Alert. */
export class PatrolState extends State<GroundAgent> {
  private waited = 0;

  override enter(agent: GroundAgent): void {
    agent.face(null);
    this.waited = 0;
    this.goToWaypoint(agent);
  }

  override execute(agent: GroundAgent): void {
    if (agent.noticed) {
      agent.changeState("alert");
      return;
    }
    if (agent.patrolRoute.length === 0) return;
    if (agent.arrived || agent.noPath) {
      this.waited += agent.dt;
      if (this.waited >= agent.data.patrol.waitTime) {
        this.waited = 0;
        agent.patrolIndex = (agent.patrolIndex + 1) % agent.patrolRoute.length;
        this.goToWaypoint(agent);
      }
    }
  }

  private goToWaypoint(agent: GroundAgent): void {
    const waypoint = agent.patrolRoute[agent.patrolIndex % Math.max(1, agent.patrolRoute.length)];
    if (waypoint !== undefined) agent.moveTo(waypoint, "walk", true);
  }
}
