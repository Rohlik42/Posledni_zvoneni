import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { DropletEmitter } from "../rendering/DropletEmitter";
import { PaletteColor } from "../rendering/PaletteColor";
import { Random } from "../utils/Random";
import type { EffectData } from "./WeaponConfig";

/** Particle capacity of the arc strokes and the impact sparks (several zaps may overlap). */
const STROKE_CAPACITY = 400;
const SPARK_CAPACITY = 120;
/** Each zap draws this many jagged branches between the same two points. */
const BRANCHES = 2;
/** Strokes barely move: they only need a direction to stretch along. */
const STROKE_DRIFT = 0.01;
const DEFAULT_SEGMENT = 0.12;
const DEFAULT_WIDTH = 0.03;
const DEFAULT_TIME = 0.12;
/** Arcs bend less towards both ends (share of the jitter at the ends of the path). */
const END_JITTER = 0.15;
/** Sparks start this far off the surface (m). */
const SURFACE_OFFSET = 0.02;

/**
 * The taser's electric arc (phase 13): a jagged line of glowing strokes from the prongs to the hit (or to the end of
 * the range), redrawn as `BRANCHES` slightly different branches, plus a burst of sparks where it touches something.
 * Strokes are stretched additive particles in HDR colour, so the arc blooms like the other weapon effects. All looks
 * come from the weapon's `effect` block in data/weapons.json.
 */
export class ElectricArc {
  private readonly strokes: DropletEmitter;
  private readonly sparks: DropletEmitter;
  private readonly random: Random;
  private readonly segment: number;
  private readonly jitter: number;
  private readonly time: number;

  constructor(
    scene: Scene,
    name: string,
    private readonly effect: EffectData,
    seed: number,
  ) {
    this.random = new Random(seed);
    this.segment = effect.segment ?? DEFAULT_SEGMENT;
    this.jitter = effect.jitter ?? 0;
    this.time = effect.time ?? DEFAULT_TIME;
    const width = effect.width ?? DEFAULT_WIDTH;
    const color = PaletteColor.color4(effect.color);
    const glowing = new Color4(color.r * effect.glow, color.g * effect.glow, color.b * effect.glow, 1);
    const end = PaletteColor.color4(effect.colorEnd, 0);
    const stretch = this.segment / width;
    this.strokes = new DropletEmitter(`${name}-arc`, scene, {
      capacity: STROKE_CAPACITY,
      color: glowing,
      colorEnd: end,
      size: [width, width],
      stretch: [stretch, stretch],
      gravity: 0,
      stretched: true,
    });
    this.sparks = new DropletEmitter(`${name}-sparks`, scene, {
      capacity: SPARK_CAPACITY,
      color: glowing,
      colorEnd: end,
      size: effect.size,
      gravity: effect.gravity,
      stretched: false,
    });
  }

  /** Live arc strokes and sparks (tests). */
  get activeParticles(): number {
    return this.strokes.activeCount + this.sparks.activeCount;
  }

  /** Draws an arc from `from` to `to`; `impact` throws sparks off the surface there (`normal` faces the shooter). */
  zap(from: Vector3, to: Vector3, impact: { normal: Vector3 } | null): void {
    const path = to.subtract(from);
    const distance = path.length();
    if (distance <= 0) return;
    const direction = path.scale(1 / distance);
    const side = Vector3.Cross(direction, Math.abs(direction.y) > 0.9 ? Vector3.Right() : Vector3.Up()).normalize();
    const up = Vector3.Cross(side, direction).normalize();
    const count = Math.max(1, Math.ceil(distance / this.segment));
    for (let branch = 0; branch < BRANCHES; branch++) {
      let previous = from.clone();
      for (let i = 1; i <= count; i++) {
        const t = i / count;
        const bend = i === count ? 0 : this.jitter * (END_JITTER + (1 - END_JITTER) * Math.sin(Math.PI * t));
        const point = from
          .add(path.scale(t))
          .addInPlace(side.scale(this.random.range(-bend, bend)))
          .addInPlace(up.scale(this.random.range(-bend, bend)));
        const stroke = point.subtract(previous);
        const length = stroke.length();
        if (length > 0) {
          this.strokes.emit({
            position: previous.add(point).scaleInPlace(1 / 2),
            velocity: stroke.scaleInPlace(STROKE_DRIFT / length),
            life: this.time,
          });
        }
        previous = point;
      }
    }
    if (impact !== null) this.burst(to, impact.normal);
  }

  dispose(): void {
    this.strokes.dispose();
    this.sparks.dispose();
  }

  private burst(point: Vector3, normal: Vector3): void {
    const { effect, random } = this;
    for (let i = 0; i < effect.particles; i++) {
      const direction = normal.add(new Vector3(random.range(-1, 1), random.range(-1, 1), random.range(-1, 1))).normalize();
      this.sparks.emit({
        position: point.add(normal.scale(SURFACE_OFFSET)),
        velocity: direction.scaleInPlace(random.range(effect.speed[0], effect.speed[1])),
        life: random.range(effect.life[0], effect.life[1]),
      });
    }
  }
}
