import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { DamageType } from "../core/DamageTypes";
import type { Simulated } from "../core/SceneSetup";
import type { Player } from "../player/Player";
import { DropletEmitter } from "../rendering/DropletEmitter";
import { PaletteColor } from "../rendering/PaletteColor";
import { ShaderPrewarm } from "../rendering/ShaderPrewarm";
import { Random } from "../utils/Random";
import type { LineOfSight } from "./ai/LineOfSight";
import type { ProjectileData } from "./EnemyConfig";

/** Low-poly spheres for bolts and muzzle flashes. */
const BOLT_SEGMENTS = 3;
/** Trail sparks drift a little sideways and fall slowly. */
const TRAIL_SPREAD = 0.6;
const TRAIL_GRAVITY = 2;
const TRAIL_CAPACITY = 400;
/** Trail spark sprite size range (m) and brightness (HDR multiple of the bolt colour). */
const TRAIL_SIZE: readonly [number, number] = [0.03, 0.07];
const TRAIL_GLOW = 2;
/** Impact sparks: share of the bolt's speed thrown back and life range (s). */
const IMPACT_BACK_SHARE = 0.5;
const IMPACT_LIFE: readonly [number, number] = [0.15, 0.4];
/** The muzzle flash is brighter than the bolt. */
const FLASH_GLOW_BOOST = 1.5;
/** Points tested along a bolt's step against the player's capsule. */
const CAPSULE_SAMPLES = 4;
/** Spark burst where a bolt ends (wall or player). */
const IMPACT_SPARKS = 14;
const IMPACT_SPEED = 3;
/** Impact sparks fly mostly up: the lowest vertical share of their random direction. */
const IMPACT_MIN_RISE = -0.3;
const TRAIL_SEED = 5;
/** The flash fades from full size to this fraction over its life. */
const FLASH_END_SCALE = 0.3;
/** Bolt and flash spheres are made once and reused (FEEDBACK 2026-10-04, combat performance): this many at load. */
const PREWARM_SPHERES = 8;

/** One electric bolt in flight. */
interface Bolt {
  mesh: Mesh;
  position: Vector3;
  velocity: Vector3;
  age: number;
  damage: number;
  damageType: DamageType;
  data: ProjectileData;
  trailDebt: number;
  /** Told when this bolt hurts the player (per-robot hit counts). */
  onPlayerHit: ((damage: number) => void) | undefined;
}

interface Flash {
  mesh: Mesh;
  age: number;
  life: number;
  size: number;
}

export interface BoltImpact {
  /** What the bolt hit: the player, a wall (mesh name) or nothing (expired). */
  hit: "player" | "wall" | "expired";
  position: Vector3;
  damage: number;
}

/**
 * Robot projectiles (electric bolts, DESIGN §5 "střílí"): glowing balls that fly straight from the muzzle, trail
 * sparks, stop at walls (a ray along each step's travel against visible static meshes; robots and targets do not block)
 * and hurt the player when they come within `radius` of the player's capsule. A bright flash marks the muzzle on fire.
 * Runs in the fixed step, so `__game.step` gives exact results.
 */
export class EnemyProjectiles implements Simulated {
  readonly onImpact = new Observable<BoltImpact>();

  private readonly bolts: Bolt[] = [];
  private readonly flashes: Flash[] = [];
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly trail: DropletEmitter;
  private readonly random = new Random(TRAIL_SEED);
  /**
   * Disabled spheres waiting for the next bolt or flash (unit diameter, scaled per use), one pool per material so a
   * reused sphere keeps its material (no new shader state per shot).
   */
  private readonly spares = new Map<StandardMaterial, Mesh[]>();
  private spheres = 0;
  private fired = 0;
  private playerHits = 0;

  constructor(
    private readonly scene: Scene,
    private readonly player: Player,
    trailColor: string,
    /** Walls stop bolts: the robots' cached ray search (same answers as `scene.pickWithRay` with this predicate). */
    private readonly sight: LineOfSight,
  ) {
    const color = PaletteColor.color4(trailColor);
    this.trail = new DropletEmitter("bolt-trail", scene, {
      capacity: TRAIL_CAPACITY,
      color: new Color4(color.r * TRAIL_GLOW, color.g * TRAIL_GLOW, color.b * TRAIL_GLOW, 1),
      colorEnd: new Color4(color.r, color.g, color.b, 0),
      size: TRAIL_SIZE,
      gravity: TRAIL_GRAVITY,
      stretched: false,
    });
  }

  /**
   * Makes the bolt and flash spheres of `data` at load (FEEDBACK 2026-10-04): the first fight then neither builds meshes
   * nor meets a new material. Robots call it once per projectile kind.
   */
  prewarm(data: ProjectileData): void {
    for (const material of [this.glow(data.color, data.glow), this.glow(data.color, data.glow * FLASH_GLOW_BOOST)]) {
      const pool = this.pool(material);
      while (pool.length < PREWARM_SPHERES) pool.push(this.createSphere(material));
      // One of them is drawn in the load-time warm-up, so the bolt's pipeline exists before the first shot.
      ShaderPrewarm.for(this.scene).addMesh(pool[0]!);
    }
  }

  get active(): number {
    return this.bolts.length;
  }

  get firedCount(): number {
    return this.fired;
  }

  get playerHitCount(): number {
    return this.playerHits;
  }

  /** Fires a bolt from `origin` towards `target`, with a muzzle flash; `onPlayerHit` hears when it hurts the player. */
  fire(origin: Vector3, target: Vector3, data: ProjectileData, damage: number, damageType: DamageType, onPlayerHit?: (damage: number) => void): void {
    const direction = target.subtract(origin);
    if (direction.lengthSquared() < Number.EPSILON) direction.set(0, 0, 1);
    direction.normalize();
    const mesh = this.sphere(this.glow(data.color, data.glow));
    mesh.scaling.setAll(data.size);
    mesh.position.copyFrom(origin);
    this.bolts.push({ mesh, position: origin.clone(), velocity: direction.scale(data.speed), age: 0, damage, damageType, data, trailDebt: 0, onPlayerHit });
    this.addFlash(origin, data);
    this.fired++;
  }

  update(dt: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i]!;
      const impact = this.advance(bolt, dt);
      if (impact !== null) {
        this.bolts.splice(i, 1);
        this.release(bolt.mesh);
        this.burst(impact.position, bolt.velocity);
        this.onImpact.notifyObservers(impact);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i]!;
      flash.age += dt;
      if (flash.age >= flash.life) {
        this.release(flash.mesh);
        this.flashes.splice(i, 1);
        continue;
      }
      const t = flash.age / flash.life;
      flash.mesh.scaling.setAll(flash.size * (1 - (1 - FLASH_END_SCALE) * t));
    }
  }

  /** Removes every bolt and flash (respawn, scene reset). */
  clear(): void {
    for (const bolt of this.bolts) this.release(bolt.mesh);
    for (const flash of this.flashes) this.release(flash.mesh);
    this.bolts.length = 0;
    this.flashes.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const pool of this.spares.values()) for (const mesh of pool) mesh.dispose();
    this.spares.clear();
    this.trail.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.onImpact.clear();
  }

  /** Moves a bolt one step; returns its impact or null while it flies on. */
  private advance(bolt: Bolt, dt: number): BoltImpact | null {
    bolt.age += dt;
    const from = bolt.position.clone();
    const travel = bolt.velocity.scale(dt);
    const to = from.add(travel);
    const playerHit = this.hitsPlayer(from, to, bolt.data.radius);
    const length = travel.length();
    // Walls and props stop bolts; robots, practice targets, effects and the viewmodel do not (the robots' sight rules,
    // except that a pickable mesh faded to visibility 0 still stops a bolt, as with the scene pick before).
    const wall = length > 0 ? this.sight.firstHit(from, travel.scale(1 / length), length, true) : null;
    const wallDistance = wall ?? Number.POSITIVE_INFINITY;
    if (playerHit !== null && playerHit <= wallDistance) {
      this.player.health.damage(bolt.damage, bolt.damageType);
      this.playerHits++;
      bolt.onPlayerHit?.(bolt.damage);
      return { hit: "player", position: from.add(travel.scale(playerHit / length)), damage: bolt.damage };
    }
    if (wall !== null) return { hit: "wall", position: from.add(travel.scale(wall / length)), damage: 0 };
    if (bolt.age >= bolt.data.life) return { hit: "expired", position: to, damage: 0 };
    bolt.position.copyFrom(to);
    bolt.mesh.position.copyFrom(to);
    this.emitTrail(bolt, dt);
    return null;
  }

  /**
   * Distance along the segment `from` → `to` at which a sphere of `radius` first touches the player's capsule, or
   * null. Sampled at a few points per step (a bolt moves ~0.2 m per step, far less than the capsule's width).
   */
  private hitsPlayer(from: Vector3, to: Vector3, radius: number): number | null {
    if (this.player.health.isDead) return null;
    const body = this.player.data.body;
    const feet = this.player.controller.position;
    const bottom = feet.y + body.radius;
    const top = feet.y + body.height - body.radius;
    const reach = body.radius + radius;
    const length = Vector3.Distance(from, to);
    for (let i = 0; i <= CAPSULE_SAMPLES; i++) {
      const t = i / CAPSULE_SAMPLES;
      const p = Vector3.Lerp(from, to, t);
      const y = Math.min(top, Math.max(bottom, p.y));
      const dx = p.x - feet.x;
      const dy = p.y - y;
      const dz = p.z - feet.z;
      if (dx * dx + dy * dy + dz * dz <= reach * reach) return t * length;
    }
    return null;
  }

  private emitTrail(bolt: Bolt, dt: number): void {
    bolt.trailDebt += bolt.data.trailPerSecond * dt;
    while (bolt.trailDebt >= 1) {
      bolt.trailDebt -= 1;
      const jitter = new Vector3(this.random.range(-1, 1), this.random.range(-1, 1), this.random.range(-1, 1)).scale(TRAIL_SPREAD);
      this.trail.emit({ position: bolt.position.clone(), velocity: jitter, life: bolt.data.trailLife });
    }
  }

  private burst(position: Vector3, velocity: Vector3): void {
    const back = velocity.normalizeToNew().scale(-IMPACT_SPEED * IMPACT_BACK_SHARE);
    for (let i = 0; i < IMPACT_SPARKS; i++) {
      const spread = new Vector3(this.random.range(-1, 1), this.random.range(IMPACT_MIN_RISE, 1), this.random.range(-1, 1)).scale(IMPACT_SPEED);
      this.trail.emit({ position: position.clone(), velocity: spread.addInPlace(back), life: this.random.range(IMPACT_LIFE[0], IMPACT_LIFE[1]) });
    }
  }

  private addFlash(position: Vector3, data: ProjectileData): void {
    const mesh = this.sphere(this.glow(data.color, data.glow * FLASH_GLOW_BOOST));
    mesh.position.copyFrom(position);
    mesh.scaling.setAll(data.flashSize);
    this.flashes.push({ mesh, age: 0, life: data.flashTime, size: data.flashSize });
  }

  /** A sphere from the pool (enabled), or a new one when every sphere is in flight. */
  private sphere(material: StandardMaterial): Mesh {
    const mesh = this.pool(material).pop() ?? this.createSphere(material);
    mesh.setEnabled(true);
    return mesh;
  }

  private pool(material: StandardMaterial): Mesh[] {
    let pool = this.spares.get(material);
    if (pool === undefined) {
      pool = [];
      this.spares.set(material, pool);
    }
    return pool;
  }

  private createSphere(material: StandardMaterial): Mesh {
    const mesh = MeshBuilder.CreateSphere(`enemy-bolt-${this.spheres++}`, { diameter: 1, segments: BOLT_SEGMENTS }, this.scene);
    mesh.isPickable = false;
    mesh.material = material;
    mesh.setEnabled(false);
    return mesh;
  }

  private release(mesh: Mesh): void {
    mesh.setEnabled(false);
    if (mesh.material instanceof StandardMaterial) this.pool(mesh.material).push(mesh);
    else mesh.dispose();
  }

  private glow(color: string, intensity: number): StandardMaterial {
    const key = `${color}|${intensity}`;
    let material = this.materials.get(key);
    if (material === undefined) {
      material = new StandardMaterial(`enemy-bolt-${key}`, this.scene);
      material.diffuseColor = Color3.Black();
      material.specularColor = Color3.Black();
      material.emissiveColor = PaletteColor.emissive(color, intensity);
      material.disableLighting = true;
      this.materials.set(key, material);
    }
    return material;
  }
}
