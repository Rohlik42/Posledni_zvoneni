import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { IDamageable } from "../core/IDamageable";
import { DropletEmitter } from "../rendering/DropletEmitter";
import { FrameTags } from "../rendering/FrameTags";
import { PaletteColor } from "../rendering/PaletteColor";
import { ShaderPrewarm } from "../rendering/ShaderPrewarm";
import { Random } from "../utils/Random";
import type { AreaQuery } from "./AreaQuery";
import type { HitResult, Hitscan } from "./Hitscan";
import type { EffectData } from "./WeaponConfig";

/** Balls made at load and reused; with all of them in the air the oldest bursts early (no mesh is built in play). */
const POOL_SIZE = 2;
const SPHERE_SEGMENTS = 10;
/** The outer glow is this share as bright as the core. */
const GLOW_SHARE = 0.4;
/** The core pulses this fast (rad/s); the glow wobbles at a different rate so the ball looks alive. */
const PULSE_RATE = 18;
const GLOW_PULSE_RATE = 11;
/** The impact point sits this far off the surface, back along the flight (m). */
const SURFACE_OFFSET = 0.05;
/** Trail sparks start within this share of the ball's radius around its centre and drift this fast (m/s). */
const TRAIL_SPREAD = 0.6;
const TRAIL_DRIFT = 0.8;
const TRAIL_CAPACITY = 400;
/** Material alpha of the additive spheres (below 1 so they are blended). */
const BLEND_ALPHA = 0.95;
/** `FrameTags` of a launch that had to burst the oldest ball early. */
const TAG_POOL = "pool";

export interface PlasmaBallOptions {
  /** Core radius (m); the glow is `glowScale` times larger. */
  radius: number;
  glowScale: number;
  /** Share by which the core's size pulses. */
  pulse: number;
  /** A robot within this distance of the flight path is struck (m). */
  hitRadius: number;
  /** A ball that meets nothing bursts after this long (s). */
  maxFlightTime: number;
  /** Trail sparks per fixed step, their size relative to `effect.size` and brightness relative to `effect.glow`. */
  trailPerStep: number;
  trailScale: number;
  trailGlow: number;
  /** The trail starts this far from the launch point (m), so it does not blot out the view right at the muzzle. */
  trailStart: number;
  /** Colours (`color` core, `colorEnd` glow and trail end), glow strength, trail size and life. */
  effect: EffectData;
  seed: number;
}

/** Where a ball burst: a point in the open just off what it struck, what it struck (null in mid-air), its heading. */
export interface PlasmaImpact {
  point: Vector3;
  hit: HitResult | null;
  direction: Vector3;
}

interface Shell {
  core: Mesh;
  glow: Mesh;
}

interface Flying {
  shell: Shell;
  /** Where it was launched (the trail starts `trailStart` m from it). */
  start: Vector3;
  position: Vector3;
  /** Where the next sweep starts (the eye on the first step, so a wall right in front is struck too). */
  last: Vector3;
  velocity: Vector3;
  age: number;
}

/**
 * The BFG 9000's plasma balls in flight (FEEDBACK 2026-10-04: like Doom's BFG): a big, slow, glowing green-cyan ball —
 * an additive core and a fainter glow sphere, both unlit HDR colour (bloom) — that flies straight at a constant speed
 * (no gravity) and leaves a trail of sparks. Every fixed step it sweeps from its previous to its next position: the
 * first thing a ray meets (wall, floor, door, prop, robot) or a robot within `hitRadius` of the path ends the flight;
 * after `maxFlightTime` it bursts in mid-air. The player is never struck (shots start at the eye, and the player has no
 * pickable body). Meshes and materials are made at load and drawn in the load-time warm-up (`ShaderPrewarm`).
 */
export class PlasmaBalls {
  private readonly spare: Shell[] = [];
  private readonly flying: Flying[] = [];
  private readonly coreMaterial: StandardMaterial;
  private readonly glowMaterial: StandardMaterial;
  private readonly trail: DropletEmitter;
  private readonly random: Random;
  private launched = 0;
  private time = 0;

  constructor(
    scene: Scene,
    name: string,
    private readonly hitscan: Hitscan,
    private readonly area: AreaQuery,
    private readonly options: PlasmaBallOptions,
  ) {
    const { effect } = options;
    this.random = new Random(options.seed);
    this.coreMaterial = PlasmaBalls.material(scene, `${name}-ball-core`, PaletteColor.emissive(effect.color, effect.glow));
    this.glowMaterial = PlasmaBalls.material(scene, `${name}-ball-glow`, PaletteColor.emissive(effect.colorEnd, effect.glow * GLOW_SHARE));
    for (let i = 0; i < POOL_SIZE; i++) this.spare.push(this.createShell(scene, `${name}-ball-${i}`));
    const color = PaletteColor.color4(effect.color);
    this.trail = new DropletEmitter(`${name}-ball-trail`, scene, {
      capacity: TRAIL_CAPACITY,
      color: new Color4(color.r * effect.glow * options.trailGlow, color.g * effect.glow * options.trailGlow, color.b * effect.glow * options.trailGlow, 1),
      colorEnd: PaletteColor.color4(effect.colorEnd, 0),
      size: [effect.size[0] * options.trailScale, effect.size[1] * options.trailScale],
      gravity: 0,
      stretched: false,
    });
  }

  get inFlight(): number {
    return this.flying.length;
  }

  get count(): number {
    return this.launched;
  }

  /** World position of the first ball in flight (tests), or null. */
  get position(): Vector3 | null {
    return this.flying[0]?.position ?? null;
  }

  /**
   * Launches a ball at `start` with `velocity`; the first sweep runs from `from` (the eye), so a wall between the eye
   * and the start is struck at once.
   */
  launch(from: Vector3, start: Vector3, velocity: Vector3, onImpact: (impact: PlasmaImpact) => void): void {
    if (this.spare.length === 0 && this.flying.length > 0) {
      FrameTags.note(TAG_POOL);
      const oldest = this.flying[0]!;
      this.remove(oldest);
      onImpact({ point: oldest.position.clone(), hit: null, direction: oldest.velocity.clone().normalize() });
    }
    const shell = this.spare.pop()!;
    const ball: Flying = { shell, start: start.clone(), position: start.clone(), last: from.clone(), velocity: velocity.clone(), age: 0 };
    this.place(ball);
    shell.core.setEnabled(true);
    shell.glow.setEnabled(true);
    this.flying.push(ball);
    this.launched++;
  }

  /** One fixed step: moves the balls, hands every burst to `onImpact`, and fades the trail. */
  update(dt: number, onImpact: (impact: PlasmaImpact) => void): void {
    this.time += dt;
    for (const ball of [...this.flying]) {
      ball.age += dt;
      const next = ball.position.add(ball.velocity.scale(dt));
      const impact = this.sweep(ball.last, next);
      if (impact !== null) {
        this.remove(ball);
        onImpact(impact);
        continue;
      }
      if (ball.age >= this.options.maxFlightTime) {
        this.remove(ball);
        onImpact({ point: next, hit: null, direction: ball.velocity.clone().normalize() });
        continue;
      }
      ball.last = next.clone();
      ball.position = next;
      this.place(ball);
      if (Vector3.Distance(ball.start, ball.position) >= this.options.trailStart) this.emitTrail(ball.position);
    }
  }

  dispose(): void {
    for (const ball of this.flying) this.spare.push(ball.shell);
    this.flying.length = 0;
    for (const { core, glow } of this.spare) {
      core.dispose();
      glow.dispose();
    }
    this.spare.length = 0;
    this.coreMaterial.dispose();
    this.glowMaterial.dispose();
    this.trail.dispose();
  }

  /** The nearest thing between `from` and `to`: what a ray meets first, or a robot within `hitRadius` of the path. */
  private sweep(from: Vector3, to: Vector3): PlasmaImpact | null {
    const path = to.subtract(from);
    const length = path.length();
    if (length <= 0) return null;
    const direction = path.scale(1 / length);
    let hit = this.hitscan.cast(from, direction, length);
    const near = this.area.nearRay(from, direction, length, 0, this.options.hitRadius, PlasmaBalls.robot);
    if (near !== null && (hit === null || near.hit.distance < hit.distance)) hit = near.hit;
    if (hit === null) return null;
    return { point: hit.point.subtract(direction.scale(SURFACE_OFFSET)), hit, direction };
  }

  private place(ball: Flying): void {
    const { radius, glowScale, pulse } = this.options;
    const { core, glow } = ball.shell;
    core.position.copyFrom(ball.position);
    glow.position.copyFrom(ball.position);
    core.scaling.setAll(radius * 2 * (1 + pulse * Math.sin(this.time * PULSE_RATE)));
    glow.scaling.setAll(radius * 2 * glowScale * (1 + pulse * Math.sin(this.time * GLOW_PULSE_RATE)));
  }

  private emitTrail(at: Vector3): void {
    const { effect, radius, trailPerStep } = this.options;
    const { random } = this;
    for (let i = 0; i < trailPerStep; i++) {
      const offset = new Vector3(random.range(-1, 1), random.range(-1, 1), random.range(-1, 1)).scaleInPlace(radius * TRAIL_SPREAD);
      const drift = offset.normalizeToNew().scaleInPlace(TRAIL_DRIFT);
      this.trail.emit({ position: at.add(offset), velocity: drift, life: random.range(effect.life[0], effect.life[1]) });
    }
  }

  private remove(ball: Flying): void {
    const index = this.flying.indexOf(ball);
    if (index >= 0) this.flying.splice(index, 1);
    ball.shell.core.setEnabled(false);
    ball.shell.glow.setEnabled(false);
    this.spare.push(ball.shell);
  }

  private createShell(scene: Scene, name: string): Shell {
    const make = (suffix: string, material: StandardMaterial): Mesh => {
      const mesh = MeshBuilder.CreateSphere(`${name}-${suffix}`, { diameter: 1, segments: SPHERE_SEGMENTS }, scene);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.applyFog = false;
      mesh.setEnabled(false);
      // Drawn once in the load-time warm-up: no pipeline is built at the first shot.
      ShaderPrewarm.for(scene).addMesh(mesh);
      return mesh;
    };
    return { core: make("core", this.coreMaterial), glow: make("glow", this.glowMaterial) };
  }

  /** Robots (things with a status) stop the ball even when the ray passes beside them. */
  private static robot(target: IDamageable): boolean {
    return target.applyStatus !== undefined;
  }

  private static material(scene: Scene, name: string, emissive: Color3): StandardMaterial {
    const material = new StandardMaterial(name, scene);
    material.disableLighting = true;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = emissive;
    material.alphaMode = Constants.ALPHA_ADD;
    // Below 1, so the ball is blended (additive) instead of drawn as an opaque sphere.
    material.alpha = BLEND_ALPHA;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    return material;
  }
}
