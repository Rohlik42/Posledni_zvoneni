import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BalloonProjectiles, type BalloonBurst } from "./BalloonProjectiles";
import { WaterEffects } from "./WaterEffects";
import { Weapon, type TargetHit, type TriggerState, type WeaponContext } from "./Weapon";
import { WeaponConfig, type WeaponData } from "./WeaponConfig";
import { WaterBalloonModel } from "./models/WaterBalloonModel";

const DEG_TO_RAD = Math.PI / 180;
/** Seed offset of the splash RNG relative to the aim RNG. */
const EFFECTS_SEED_OFFSET = 7;
/** A throw leaves from this far in front of the eye (m), clear of the player's capsule. */
const THROW_START_AHEAD = 0.45;
/** …and this far below the eye (the hand). */
const THROW_START_DROP = 0.12;

/** The latest burst, for tests (`__game.weapons.state("waterBalloons")`). */
interface BurstInfo {
  targets: number;
  damage: number;
  point: Vector3;
}

/**
 * Weapon 3, water balloons (DESIGN §4: thrown in an arc, AoE, collected): a throw launches a Havok-simulated balloon
 * (`BalloonProjectiles`) at `throwSpeed`, tilted up by `throwUpDeg`. Where it bursts, every robot whose body is within
 * `aoeRadius` and in sight of the splash takes water damage, full at the centre and falling linearly to
 * `aoeEdgeDamage` × damage at the edge; a big splash and a wet spot mark the spot. Balloons are the reserve
 * (`ammo.capacity` 0): picked up (`AmmoPickup`), kept in `WeaponInventory`. The balloon in the glove re-inflates over
 * `regrowTime` after a throw and is gone when the last one has been thrown.
 */
export class WaterBalloons extends Weapon {
  private readonly projectiles: BalloonProjectiles;
  private readonly effects: WaterEffects;
  private readonly aoeRadius: number;
  private readonly aoeEdge: number;
  private readonly throwSpeed: number;
  private readonly throwUp: number;
  private readonly regrowTime: number;
  private sinceThrow = Number.POSITIVE_INFINITY;
  private bursts = 0;
  private lastBurst: BurstInfo | null = null;

  constructor(context: WeaponContext, data: WeaponData) {
    super(context, data);
    this.aoeRadius = WeaponConfig.param(data, "aoeRadius");
    this.aoeEdge = WeaponConfig.param(data, "aoeEdgeDamage");
    this.throwSpeed = WeaponConfig.param(data, "throwSpeed");
    this.throwUp = WeaponConfig.param(data, "throwUpDeg") * DEG_TO_RAD;
    this.regrowTime = WeaponConfig.param(data, "regrowTime");
    this.effects = new WaterEffects(context.scene, WeaponConfig.stream(data), context.config.aimRandomSeed + EFFECTS_SEED_OFFSET);
    this.projectiles = new BalloonProjectiles(context.scene, context.hitscan, {
      radius: WeaponConfig.param(data, "projectileRadius"),
      mass: WeaponConfig.param(data, "projectileMass"),
      maxFlightTime: WeaponConfig.param(data, "maxFlightTime"),
      scale: WeaponConfig.param(data, "projectileScale"),
      variant: data.viewmodel.variant,
    });
  }

  get effectStats(): { droplets: number; wetSpots: number } {
    return { droplets: this.effects.activeDroplets, wetSpots: this.effects.wetSpots.count };
  }

  override get extraState(): Record<string, number> {
    const last = this.lastBurst;
    return {
      inFlight: this.projectiles.inFlight,
      thrown: this.projectiles.thrown,
      bursts: this.bursts,
      aoeRadius: this.aoeRadius,
      lastBurstTargets: last?.targets ?? 0,
      lastBurstDamage: last?.damage ?? 0,
      lastBurstX: last?.point.x ?? 0,
      lastBurstY: last?.point.y ?? 0,
      lastBurstZ: last?.point.z ?? 0,
    };
  }

  /** Balloons still fly and burst after the player switched away; the inventory steps every owned weapon's flight. */
  override update(dt: number, trigger: TriggerState, ready: boolean): void {
    super.update(dt, trigger, ready);
    this.stepFlight(dt);
  }

  /** Advances balloons in flight (also while another weapon is in hand). */
  stepFlight(dt: number): void {
    this.sinceThrow += dt;
    this.projectiles.update(dt, (burst) => this.burst(burst));
    this.effects.update(dt);
  }

  override dispose(): void {
    this.projectiles.dispose();
    this.effects.dispose();
    super.dispose();
  }

  protected createModel(): WaterBalloonModel {
    return new WaterBalloonModel(this.context.scene, { variant: this.data.viewmodel.variant, lightScale: this.data.viewmodel.lightScale });
  }

  protected shoot(aim: { origin: Vector3; direction: Vector3 }): void {
    const { direction } = aim;
    const start = aim.origin.add(direction.scale(THROW_START_AHEAD));
    start.y -= THROW_START_DROP;
    this.projectiles.launch(start, WaterBalloons.tiltUp(direction, this.throwUp).scaleInPlace(this.throwSpeed));
    this.sinceThrow = 0;
  }

  /** One fixed step while another weapon is in hand: balloons already thrown keep flying and bursting. */
  override idle(dt: number): void {
    this.stepFlight(dt);
  }

  /** `direction` pitched up by `angle` in its vertical plane (capped at straight up). */
  private static tiltUp(direction: Vector3, angle: number): Vector3 {
    const horizontal = Math.hypot(direction.x, direction.z);
    if (horizontal <= 0) return direction.clone();
    const pitch = Math.min(Math.PI / 2, Math.atan2(direction.y, horizontal) + angle);
    const scale = Math.cos(pitch) / horizontal;
    return new Vector3(direction.x * scale, Math.sin(pitch), direction.z * scale);
  }

  protected override animate(): void {
    const { balloon } = this.model as WaterBalloonModel;
    const grown = this.reserve > 0 ? Math.min(1, this.sinceThrow / this.regrowTime) : 0;
    balloon.scaling.setAll(Math.max(grown, Number.EPSILON));
    balloon.setEnabled(grown > 0);
  }

  private burst(burst: BalloonBurst): void {
    const { area, sounds } = this.context;
    const hits: TargetHit[] = [];
    let total = 0;
    for (const reached of area.sphere(burst.point, this.aoeRadius, burst.hit)) {
      const share = 1 - (1 - this.aoeEdge) * Math.min(1, reached.distance / this.aoeRadius);
      const damageDealt = this.damage(reached.hit, share);
      total += damageDealt;
      hits.push({ hit: reached.hit, damageDealt });
    }
    const normal = burst.hit?.normal ?? Vector3.Up();
    this.effects.burst(burst.point, normal, burst.hit);
    sounds.play(this.data.sounds.impact);
    this.bursts++;
    this.lastBurst = { targets: hits.length, damage: total, point: burst.point.clone() };
    const speed = burst.velocity.length();
    const direction = speed > 0 ? burst.velocity.scale(1 / speed) : Vector3.Down();
    this.onShot.notifyObservers({ weapon: this.id, origin: burst.point, direction, hit: hits[0]?.hit ?? burst.hit, damageDealt: total, hits });
  }
}
