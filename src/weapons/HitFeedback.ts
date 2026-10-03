import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { SynthSounds } from "../audio/SynthSounds";
import type { Player } from "../player/Player";
import { DropletEmitter } from "../rendering/DropletEmitter";
import { PaletteColor } from "../rendering/PaletteColor";
import { Random } from "../utils/Random";
import type { FeelData } from "./FeelConfig";
import type { ShotEvent } from "./Weapon";

const SPARK_CAPACITY = 400;
const FLASH_CAPACITY = 16;
/** Sparks cool towards dark orange (share of green kept at the end of their life). */
const SPARK_END_GREEN = 0.35;
/** Sparks start this far off the surface so they do not clip into the robot's plate (m). */
const SURFACE_OFFSET = 0.03;

/** Counters for tests (`__game.weapons.feedback()`). */
export interface HitFeedbackStats {
  /** Robot hits that sparked. */
  metalHits: number;
  sparks: number;
  slows: number;
  robotDeaths: number;
  /** Strength 0–1 of the latest robot-death shake (0 = none yet). */
  lastDeathShake: number;
}

/**
 * What a hit feels like beyond the damage number (phase 5, „musí být zábavné střílet“): a robot hit throws sparks
 * from the hit point along the surface normal, flashes briefly and staggers the robot (short slow through
 * `IDamageable.applyStatus`); a destroyed robot shakes the camera (weaker with distance) and plays a crunch. Which
 * impact sound a surface makes is chosen by the weapon (`Weapon.playImpact`). All numbers are in `data/feel.json`.
 *
 * Weapons and enemies do not import each other: robots are recognised by `surface: "metal"` on the hit's owner and
 * scenes report deaths with `robotDestroyed(position)`.
 */
export class HitFeedback {
  private readonly sparks: DropletEmitter;
  private readonly flashes: DropletEmitter;
  private readonly random: Random;
  private readonly counters: HitFeedbackStats = { metalHits: 0, sparks: 0, slows: 0, robotDeaths: 0, lastDeathShake: 0 };

  constructor(
    scene: Scene,
    private readonly player: Player,
    private readonly sounds: SynthSounds,
    private readonly feel: FeelData,
    seed: number,
  ) {
    this.random = new Random(seed);
    const hit = feel.robotHit;
    const spark = PaletteColor.color4(hit.sparkColor);
    this.sparks = new DropletEmitter("hit-sparks", scene, {
      capacity: SPARK_CAPACITY,
      color: new Color4(spark.r * hit.sparkGlow, spark.g * hit.sparkGlow, spark.b * hit.sparkGlow, 1),
      colorEnd: new Color4(spark.r, spark.g * SPARK_END_GREEN, 0, 0),
      size: hit.sparkSize,
      gravity: hit.gravity,
      stretched: false,
    });
    this.flashes = new DropletEmitter("hit-flash", scene, {
      capacity: FLASH_CAPACITY,
      color: new Color4(spark.r * hit.flashGlow, spark.g * hit.flashGlow, spark.b * hit.flashGlow, 1),
      colorEnd: new Color4(spark.r, spark.g, spark.b, 0),
      size: [hit.flashSize, hit.flashSize],
      gravity: 0,
      stretched: false,
    });
  }

  get stats(): HitFeedbackStats {
    return { ...this.counters };
  }

  /** Live spark particles (tests). */
  get activeSparks(): number {
    return this.sparks.activeCount;
  }

  /** Called for every shot of every weapon. */
  shot(shot: ShotEvent): void {
    const hit = shot.hit;
    if (hit === null || hit.target === null || hit.target.surface !== "metal" || !(shot.damageDealt > 0)) return;
    this.counters.metalHits++;
    const { robotHit } = this.feel;
    const from = hit.point.add(hit.normal.scale(SURFACE_OFFSET));
    for (let i = 0; i < robotHit.sparks; i++) {
      const direction = hit.normal
        .add(new Vector3(this.random.range(-1, 1), this.random.range(-1, 1), this.random.range(-1, 1)).scaleInPlace(robotHit.spread))
        .normalize();
      const speed = this.random.range(robotHit.sparkSpeed[0], robotHit.sparkSpeed[1]);
      this.sparks.emit({ position: from.clone(), velocity: direction.scaleInPlace(speed), life: this.random.range(robotHit.sparkLife[0], robotHit.sparkLife[1]) });
      this.counters.sparks++;
    }
    this.flashes.emit({ position: from, velocity: Vector3.Zero(), life: robotHit.flashTime });
    if (hit.target.alive && hit.target.applyStatus !== undefined && robotHit.slowSeconds > 0) {
      if (hit.target.applyStatus("slow", robotHit.slowSeconds, robotHit.slowStrength) > 0) this.counters.slows++;
    }
  }

  /** A robot was destroyed at `position` (feet): crunch + camera shake that fades with distance. */
  robotDestroyed(position: Vector3): void {
    const shake = this.feel.screenShake.robotDeath;
    const distance = Vector3.Distance(position, this.player.controller.position);
    const strength = Math.max(0, 1 - distance / shake.maxDistance);
    this.counters.robotDeaths++;
    this.counters.lastDeathShake = strength;
    this.sounds.play(this.feel.impact.robotBreak);
    if (strength > 0) this.player.camera.kick("robotDeath", shake, strength);
  }

  dispose(): void {
    this.sparks.dispose();
    this.flashes.dispose();
  }
}
