import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Enemy } from "../enemies/Enemy";
import { DropletEmitter } from "../rendering/DropletEmitter";
import { PaletteColor } from "../rendering/PaletteColor";
import { Random } from "../utils/Random";
import type { SparksData } from "./AtmosphereConfig";

/** Sparks leave a damaged robot upwards and outwards more than downwards. */
const UPWARD_BIAS = 0.7;
const SPARK_END_GREEN = 0.3;

/**
 * Sparks from damaged things (phase 19): a robot below `robotHealth` of its health spits a burst every
 * `robotInterval` s from its body, a failing fluorescent tube (`LightAnimator`) when it drops out. One additive
 * `DropletEmitter` for all of them; bursts are scheduled in the fixed simulation step, so `__game.step` drives them.
 */
export class DamageSparks {
  /** A burst went off at this point (phase 20: `AudioService` crackles there). */
  readonly onBurst = new Observable<Vector3>();
  private readonly emitter: DropletEmitter;
  private readonly random: Random;
  private readonly timers = new Map<Enemy, number>();
  private bursts = 0;

  constructor(
    scene: Scene,
    private readonly data: SparksData,
    private readonly robots: () => readonly Enemy[],
    seed: number,
  ) {
    this.random = new Random(seed);
    const c = PaletteColor.color3(data.color).scale(data.glow);
    this.emitter = new DropletEmitter("damage-sparks", scene, {
      capacity: data.capacity,
      color: new Color4(c.r, c.g, c.b, 1),
      colorEnd: new Color4(c.r, c.g * SPARK_END_GREEN, 0, 0),
      size: data.size,
      gravity: -data.gravity,
      stretched: false,
    });
  }

  /** Bursts emitted so far (robots and lamps). */
  get burstCount(): number {
    return this.bursts;
  }

  /** A burst of sparks at `position` (`count` from `lampCount` when not given). */
  burst(position: Vector3, count?: number): void {
    const d = this.data;
    const n = count ?? Math.round(this.random.range(d.lampCount[0], d.lampCount[1]));
    for (let i = 0; i < n; i++) {
      const direction = new Vector3(this.random.range(-1, 1), this.random.range(-1 + UPWARD_BIAS, 1), this.random.range(-1, 1)).normalize();
      this.emitter.emit({ position: position.clone(), velocity: direction.scale(this.random.range(d.speed[0], d.speed[1])), life: this.random.range(d.life[0], d.life[1]) });
    }
    this.bursts += 1;
    this.onBurst.notifyObservers(position);
  }

  update(dt: number): void {
    const d = this.data;
    for (const robot of this.robots()) {
      if (!robot.alive || robot.healthFraction >= d.robotHealth) {
        this.timers.delete(robot);
        continue;
      }
      const left = (this.timers.get(robot) ?? this.random.range(0, d.robotInterval[1])) - dt;
      if (left > 0) {
        this.timers.set(robot, left);
        continue;
      }
      this.timers.set(robot, this.random.range(d.robotInterval[0], d.robotInterval[1]));
      this.burst(robot.center, Math.round(this.random.range(d.robotCount[0], d.robotCount[1])));
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
