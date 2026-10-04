import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import type { DamageType } from "../core/DamageTypes";
import { DamageTargets } from "../core/DamageTargets";
import type { IDamageable } from "../core/IDamageable";
import { BlueprintBuilder } from "../rendering/BlueprintBuilder";
import type { DetailsData, LooseItemData } from "./DetailsConfig";
import type { Level } from "./Level";
import { LevelLayout } from "./LevelLayout";
import type { RoomLighting } from "./RoomLighting";

const HALF = 0.5;
/** A hit also lifts the piece a little, so it tumbles instead of sliding. */
const LIFT = 0.35;
/** Hanging ceiling pieces hang this far below the ceiling, tilted by `HANG_TILT` (rad). */
const HANG_GAP = 0.03;
const HANG_TILT = 0.35;
/** Loose pieces start this far above the floor and settle under gravity. */
const DROP_HEIGHT = 0.02;
const FRICTION = 0.7;
const RESTITUTION = 0.1;

export interface LoosePiece {
  readonly item: LooseItemData;
  readonly mesh: Mesh;
  readonly body: PhysicsBody;
  readonly start: Vector3;
  hanging: boolean;
  pushes: number;
}

/**
 * Falling objects (phase 19, DESIGN §8 „Havok – padající předměty“): a few dynamic Havok bodies of `data/details.json →
 * loose` — chairs, rubble chunks, planks and ceiling pieces. A hit pushes them away from the player (impulse =
 * damage × `impulsePerDamage[type]`, capped), the quiz trap and a destroyed robot push everything within
 * `blast.radius`; a hanging ceiling piece is static until the first push, then falls. They are damage targets (shots,
 * the extinguisher cone, balloons and the hose reach them) but never take damage, and robots see and shoot through
 * them like through other damageables. Placed off the route (data test), lit by the room they are in. Full game only.
 */
export class LooseDebris {
  readonly pieces: LoosePiece[] = [];

  constructor(
    scene: Scene,
    level: Level,
    lighting: RoomLighting,
    private readonly data: DetailsData["loose"],
    private readonly pusher: () => Vector3,
  ) {
    const layout = level.layout;
    data.items.forEach((item, index) => {
      const kind = data.kinds[item.kind]!;
      const room = layout.room(item.room);
      const [sx, sy, sz] = kind.size;
      const mesh = kind.blueprint === undefined ? LooseDebris.box(scene, `loose:${index}:${item.kind}`, kind.size) : LooseDebris.model(scene, `loose:${index}:${item.kind}`, kind.blueprint);
      if (kind.blueprint === undefined) mesh.material = level.materials.get(kind.material);
      const hanging = item.hanging === true && layout.hasCeiling(room);
      const y = hanging ? layout.ceilingY(room) - sy * HALF - HANG_GAP - Math.sin(HANG_TILT) * sx * HALF : layout.floorY(room) + (kind.blueprint === undefined ? sy * HALF : 0) + DROP_HEIGHT;
      const p = LevelLayout.toWorld(item.x, y, item.z);
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(index * 1.3, 0, hanging ? HANG_TILT : 0);
      const body = new PhysicsBody(mesh, hanging ? PhysicsMotionType.STATIC : PhysicsMotionType.DYNAMIC, false, scene);
      // Blueprint models stand on their origin: the box shape sits half its height above it.
      const centre = kind.blueprint === undefined ? Vector3.Zero() : new Vector3(0, sy * HALF, 0);
      const shape = new PhysicsShapeBox(centre, Quaternion.Identity(), new Vector3(sx, sy, sz), scene);
      shape.material = { friction: FRICTION, restitution: RESTITUTION };
      body.shape = shape;
      body.setMassProperties({ mass: kind.mass });
      const piece: LoosePiece = { item, mesh, body, start: mesh.position.clone(), hanging, pushes: 0 };
      this.pieces.push(piece);
      DamageTargets.attach(mesh, this.target(piece));
      lighting.track(() => [mesh, ...mesh.getChildMeshes()], () => mesh.position);
    });
  }

  /** Pushes a piece as if hit by `amount` damage of `type` from the player's eyes. */
  hit(piece: LoosePiece, amount: number, type: DamageType): void {
    const strength = Math.min(this.data.maxImpulse, amount * this.data.impulsePerDamage[type]);
    if (strength <= 0) return;
    const direction = piece.mesh.position.subtract(this.pusher());
    direction.y = 0;
    if (direction.lengthSquared() < Number.EPSILON) direction.set(0, 0, 1);
    direction.normalize().addInPlace(new Vector3(0, LIFT, 0)).normalize();
    this.push(piece, direction.scaleInPlace(strength));
  }

  /** A blast (quiz trap, destroyed robot) pushes every piece within `blast.radius`, weaker with the distance. */
  blast(at: Vector3): void {
    const { radius, impulse } = this.data.blast;
    for (const piece of this.pieces) {
      const away = piece.mesh.position.subtract(at);
      const distance = away.length();
      if (distance > radius) continue;
      if (distance < Number.EPSILON) away.set(0, 1, 0);
      away.normalize().addInPlace(new Vector3(0, LIFT, 0)).normalize();
      this.push(piece, away.scaleInPlace(impulse * (1 - distance / radius)));
    }
  }

  /** How far each piece moved from where it started (m). */
  moved(): number[] {
    return this.pieces.map((p) => Vector3.Distance(p.start, p.mesh.position));
  }

  dispose(): void {
    for (const piece of this.pieces) {
      piece.body.dispose();
      piece.mesh.dispose();
    }
    this.pieces.length = 0;
  }

  private push(piece: LoosePiece, impulse: Vector3): void {
    if (piece.hanging) {
      piece.hanging = false;
      piece.body.setMotionType(PhysicsMotionType.DYNAMIC);
    }
    piece.body.applyImpulse(impulse, piece.mesh.getAbsolutePosition());
    piece.pushes += 1;
  }

  private target(piece: LoosePiece): IDamageable {
    return {
      health: 1,
      alive: true,
      takeDamage: (amount: number, type: DamageType): number => {
        this.hit(piece, amount, type);
        // Furniture does not lose health: nothing is counted as damage dealt.
        return 0;
      },
    };
  }

  private static box(scene: Scene, name: string, size: [number, number, number]): Mesh {
    const mesh = CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
    mesh.isPickable = true;
    return mesh;
  }

  /** A blueprint model (school chair) merged into one mesh with its materials, origin at its feet. */
  private static model(scene: Scene, name: string, blueprint: string): Mesh {
    const built = BlueprintBuilder.build(scene, blueprint, { name });
    for (const mesh of built.meshes) mesh.computeWorldMatrix(true);
    const merged = Mesh.MergeMeshes([...built.meshes], false, true, undefined, false, true);
    built.root.dispose();
    if (merged === null) throw new Error(`LooseDebris: blueprint ${blueprint} has no meshes`);
    merged.name = name;
    merged.parent = null;
    merged.isPickable = true;
    return merged;
  }
}
