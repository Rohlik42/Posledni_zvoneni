import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Simulated } from "../core/SceneSetup";
import { DropletEmitter } from "../rendering/DropletEmitter";
import { EffectBudget } from "../rendering/EffectBudget";
import { PaletteColor } from "../rendering/PaletteColor";
import { Random } from "../utils/Random";
import type { DeathData } from "./EnemyConfig";

const SPARK_CAPACITY = 900;
/** Sparks fall slower than debris (they are light and burn out). */
const SPARK_GRAVITY_SHARE = 0.5;
/** Spin below this (rad/s) stops once a part rests on the floor. */
const REST_SPIN = 0.2;
/** A part rests when it bounces slower than this (m/s). */
const REST_SPEED = 0.4;
/** Linger sparks rise from this high above the floor (the broken torso). */
const LINGER_HEIGHT = 0.9;
const LINGER_SPEED = 2.2;
/** How deep a part sinks into the floor while it fades out (m). */
const SINK_DEPTH = 0.3;
/** Sparks cool from the palette colour towards dark red (share of green kept at the end). */
const SPARK_END_GREEN = 0.4;
/** Random sideways velocity added to each part (m/s) and the share range of `spin` a part gets. */
const SIDE_JITTER = 0.5;
const SPIN_SHARE: readonly [number, number] = [0.3, 1];
/** Spark directions: upward component range (sparks fly up more than down). */
const SPARK_UP: readonly [number, number] = [0.2, 1.2];

interface Piece {
  mesh: Mesh;
  velocity: Vector3;
  axis: Vector3;
  spin: number;
  /** Half the part's size: the floor stops it this far above the floor. */
  extent: number;
  age: number;
}

interface Wreck {
  pieces: Piece[];
  floorY: number;
  origin: Vector3;
  age: number;
  /** When the parts are gone (s): `data.life` × the preset's `debrisLife`, shortened when too many wrecks lie around. */
  life: number;
  lingerDebt: number;
  data: DeathData;
}

/**
 * What is left of destroyed robots: the model's parts fly apart (outward + up, spinning), fall, bounce off the floor
 * and sink away after `life` seconds, while a burst of sparks flies out and the wreck keeps sparking for a while.
 * Simple ballistic motion in the fixed step (no Havok bodies: dozens of bodies per death are not worth it and the
 * parts must not block the player). Seeded, so a death looks the same in every run.
 */
export class RobotDebris implements Simulated {
  private readonly wrecks: Wreck[] = [];
  private readonly sparks: DropletEmitter;
  private readonly random: Random;
  /** Wreck lifetime and count caps of the quality preset (FEEDBACK 2026-10-04). */
  private readonly budget: EffectBudget;

  constructor(scene: Scene, data: DeathData) {
    this.random = new Random(data.seed);
    this.budget = EffectBudget.for(scene);
    const color = PaletteColor.color4(data.sparkColor);
    this.sparks = new DropletEmitter("robot-sparks", scene, {
      capacity: SPARK_CAPACITY,
      color: new Color4(color.r * data.sparkGlow, color.g * data.sparkGlow, color.b * data.sparkGlow, 1),
      colorEnd: new Color4(color.r, color.g * SPARK_END_GREEN, 0, 0),
      size: data.sparkSize,
      gravity: data.gravity * SPARK_GRAVITY_SHARE,
      stretched: false,
    });
  }

  /** Pieces still on the floor or in the air. */
  get pieceCount(): number {
    return this.wrecks.reduce((sum, wreck) => sum + wreck.pieces.length, 0);
  }

  get sparkCount(): number {
    return this.sparks.activeCount;
  }

  /** Throws `parts` apart from `origin` (the robot's feet) with a burst of sparks. */
  explode(parts: Mesh[], origin: Vector3, data: DeathData): void {
    const pieces = parts.map((mesh) => {
      const center = mesh.getAbsolutePosition();
      const outward = center.subtract(origin);
      outward.y = 0;
      if (outward.lengthSquared() < Number.EPSILON) outward.set(this.random.range(-1, 1), 0, this.random.range(-1, 1));
      outward.normalize();
      const speed = this.random.range(data.speed[0], data.speed[1]);
      const jitter = new Vector3(this.random.range(-SIDE_JITTER, SIDE_JITTER), this.random.range(data.up[0], data.up[1]), this.random.range(-SIDE_JITTER, SIDE_JITTER));
      const velocity = outward.scale(speed).addInPlace(jitter);
      const axis = new Vector3(this.random.range(-1, 1), this.random.range(-1, 1), this.random.range(-1, 1)).normalize();
      if (mesh.rotationQuaternion === null) mesh.rotationQuaternion = Quaternion.FromEulerVector(mesh.rotation);
      mesh.refreshBoundingInfo();
      const extent = mesh.getBoundingInfo().boundingBox.extendSize;
      return { mesh, velocity, axis, spin: this.random.range(SPIN_SHARE[0], SPIN_SHARE[1]) * data.spin, extent: Math.min(extent.x, extent.y, extent.z) * mesh.scaling.y, age: 0 };
    });
    const life = Math.max(data.fade, data.life * this.budget.debrisLife);
    this.wrecks.push({ pieces, floorY: origin.y, origin: origin.clone(), age: 0, life, lingerDebt: 0, data });
    // Too many wrecks: the oldest start sinking now (oldest first; one already sinking keeps its pace).
    for (let i = 0; i < this.wrecks.length - this.budget.maxWrecks; i++) {
      const old = this.wrecks[i]!;
      old.life = Math.min(old.life, old.age + old.data.fade);
    }
    const burstFrom = origin.add(new Vector3(0, LINGER_HEIGHT, 0));
    for (let i = 0; i < data.sparks; i++) this.spark(burstFrom, data, this.random.range(data.sparkSpeed[0], data.sparkSpeed[1]));
  }

  update(dt: number): void {
    for (let w = this.wrecks.length - 1; w >= 0; w--) {
      const wreck = this.wrecks[w]!;
      wreck.age += dt;
      const { data } = wreck;
      if (wreck.age < data.lingerTime) {
        wreck.lingerDebt += data.lingerSparksPerSecond * dt;
        const from = wreck.origin.add(new Vector3(0, LINGER_HEIGHT, 0));
        while (wreck.lingerDebt >= 1) {
          wreck.lingerDebt -= 1;
          this.spark(from, data, LINGER_SPEED);
        }
      }
      for (const piece of wreck.pieces) this.move(piece, wreck, dt);
      if (wreck.age >= wreck.life) {
        for (const piece of wreck.pieces) piece.mesh.dispose();
        this.wrecks.splice(w, 1);
      }
    }
  }

  dispose(): void {
    for (const wreck of this.wrecks) for (const piece of wreck.pieces) piece.mesh.dispose();
    this.wrecks.length = 0;
    this.sparks.dispose();
  }

  private move(piece: Piece, wreck: Wreck, dt: number): void {
    const { data } = wreck;
    piece.age += dt;
    const mesh = piece.mesh;
    piece.velocity.y -= data.gravity * dt;
    mesh.position.addInPlace(piece.velocity.scale(dt));
    const fadeStart = wreck.life - data.fade;
    const sink = wreck.age > fadeStart && data.fade > 0 ? ((wreck.age - fadeStart) / data.fade) * SINK_DEPTH : 0;
    const floor = wreck.floorY + piece.extent - sink;
    if (mesh.position.y < floor) {
      mesh.position.y = floor;
      if (piece.velocity.y < 0) piece.velocity.y = Math.abs(piece.velocity.y) < REST_SPEED ? 0 : -piece.velocity.y * data.bounce;
      piece.velocity.x *= 1 - data.friction;
      piece.velocity.z *= 1 - data.friction;
      piece.spin *= 1 - data.friction;
      if (piece.spin < REST_SPIN) piece.spin = 0;
    }
    if (piece.spin > 0 && mesh.rotationQuaternion !== null) {
      const turn = Quaternion.RotationAxis(piece.axis, piece.spin * dt);
      turn.multiplyToRef(mesh.rotationQuaternion, mesh.rotationQuaternion);
    }
  }

  private spark(from: Vector3, data: DeathData, speed: number): void {
    const direction = new Vector3(this.random.range(-1, 1), this.random.range(SPARK_UP[0], SPARK_UP[1]), this.random.range(-1, 1)).normalize();
    this.sparks.emit({ position: from.clone(), velocity: direction.scale(speed), life: this.random.range(data.sparkLife[0], data.sparkLife[1]) });
  }
}
