import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { DropletEmitter } from "../rendering/DropletEmitter";
import { PaletteColor } from "../rendering/PaletteColor";
import { Random } from "../utils/Random";
import type { HitResult } from "./Hitscan";
import type { StreamData } from "./WeaponConfig";
import { WetSpots } from "./WetSpots";

/** Particle capacity in shots' worth of droplets (a burst of fire must not run out). */
const STREAM_CAPACITY_SHOTS = 12;
const SPLASH_CAPACITY_SHOTS = 8;
/** Splash droplets leave mostly along the surface normal, this much sideways. */
const SPLASH_SIDEWAYS = 0.9;
/** Splash droplets start this far off the surface so they do not spawn inside it. */
const SPLASH_LIFT = 0.03;

/**
 * Visible water for a shot: a jet of stretched droplets from the muzzle to where the ray ended, a splash of spray
 * along the hit surface's normal and a wet spot on the surface. Droplets of one shot travel at different speeds, so
 * the jet reads as a streak; their life is set so the fastest arrive at the hit point and slight lift cancels the
 * small `streamGravity` there.
 */
export class WaterEffects {
  readonly wetSpots: WetSpots;
  private readonly stream: DropletEmitter;
  private readonly splash: DropletEmitter;
  private readonly random: Random;

  constructor(
    scene: Scene,
    private readonly data: StreamData,
    seed: number,
  ) {
    this.random = new Random(seed);
    const color = PaletteColor.color4(data.color);
    const glowing = color.scale(data.glow);
    glowing.a = 1;
    const deep = PaletteColor.color4(data.colorDeep, 0);
    this.stream = new DropletEmitter("water-stream", scene, {
      capacity: data.dropletsPerShot * STREAM_CAPACITY_SHOTS,
      color: glowing,
      colorEnd: deep,
      size: data.dropletSize,
      stretch: data.dropletStretch,
      gravity: data.streamGravity,
      stretched: true,
      essential: true,
    });
    this.splash = new DropletEmitter("water-splash", scene, {
      capacity: Math.max(1, data.splashDroplets * SPLASH_CAPACITY_SHOTS),
      color: glowing,
      colorEnd: deep,
      size: data.splashSize,
      gravity: data.gravity,
      stretched: false,
    });
    this.wetSpots = new WetSpots(scene, data, this.random);
  }

  /** Particles alive right now (jet + splash). */
  get activeDroplets(): number {
    return this.stream.activeCount + this.splash.activeCount;
  }

  /** Jet from `muzzle` to `end`; splash and wet spot when the ray `hit` something. */
  shot(muzzle: Vector3, end: Vector3, hit: HitResult | null): void {
    this.jet(muzzle, end);
    if (hit !== null) {
      this.spray(hit.point, hit.normal, hit.distance);
      this.wetSpots.add(hit.mesh, hit.point, hit.normal);
    }
  }

  /** A splash without a jet (a bursting water balloon, phase 13): full spray at `point`, a wet spot on the hit surface. */
  burst(point: Vector3, normal: Vector3, hit: HitResult | null): void {
    this.spray(point, normal, this.data.splashFullDistance);
    if (hit !== null) this.wetSpots.add(hit.mesh, hit.point, hit.normal);
  }

  update(dt: number): void {
    this.wetSpots.update(dt);
  }

  dispose(): void {
    this.stream.dispose();
    this.splash.dispose();
    this.wetSpots.dispose();
  }

  private jet(muzzle: Vector3, end: Vector3): void {
    const { data, random } = this;
    const path = end.subtract(muzzle);
    const distance = path.length();
    if (distance <= 0) return;
    const direction = path.scale(1 / distance);
    const life = distance / data.dropletSpeed;
    // Lift that brings a droplet back onto the aim line after `life` seconds of streamGravity.
    const lift = (data.streamGravity * life) / 2;
    for (let i = 0; i < data.dropletsPerShot; i++) {
      const speed = data.dropletSpeed * random.range(1 - data.dropletSpeedSpread, 1);
      const velocity = direction.scale(speed);
      velocity.x += random.range(-data.dropletJitter, data.dropletJitter) * speed;
      velocity.y += lift + random.range(-data.dropletJitter, data.dropletJitter) * speed;
      velocity.z += random.range(-data.dropletJitter, data.dropletJitter) * speed;
      this.stream.emit({ position: muzzle.clone(), velocity, life });
    }
  }

  /** Spray off the surface; point-blank hits spray less, so droplets do not burst over the whole view. */
  private spray(point: Vector3, normal: Vector3, distance: number): void {
    const { data, random } = this;
    const start = point.add(normal.scale(SPLASH_LIFT));
    const count = Math.round(data.splashDroplets * Math.min(1, distance / data.splashFullDistance));
    for (let i = 0; i < count; i++) {
      const direction = new Vector3(
        normal.x + random.range(-SPLASH_SIDEWAYS, SPLASH_SIDEWAYS),
        normal.y + random.range(-SPLASH_SIDEWAYS, SPLASH_SIDEWAYS),
        normal.z + random.range(-SPLASH_SIDEWAYS, SPLASH_SIDEWAYS),
      ).normalize();
      if (Vector3.Dot(direction, normal) < 0) direction.subtractInPlace(normal.scale(2 * Vector3.Dot(direction, normal)));
      const velocity = direction.scale(random.range(data.splashSpeed[0], data.splashSpeed[1]));
      this.splash.emit({ position: start.clone(), velocity, life: random.range(data.splashLife[0], data.splashLife[1]) });
    }
  }
}
