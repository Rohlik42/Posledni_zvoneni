import type { Material } from "@babylonjs/core/Materials/material";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBoxVertexData } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox, PhysicsShapeContainer } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import type { Physics } from "../core/Physics";
import type { AuditSurface } from "./GeometryAudit";
import type { BoxPiece, PieceList, QuadPiece } from "./GreyboxTypes";

const UV_PER_VERTEX = 2;
const XYZ = 3;
const QUAD_UVS = [0, 1, 1, 1, 1, 0, 0, 0];
const QUAD_INDICES = [0, 1, 2, 0, 2, 3];
const COLLIDERS = "colliders";
/** Hidden colliders left out of the navmesh (railing slabs). */
const NON_NAVIGABLE_COLLIDERS = "railing-colliders";
/** Name suffix of the merged meshes of unpickable pieces (generated details, phase 19). */
const DETAIL_SUFFIX = ":detail";

/** Meshes of one owner (room id). */
export interface OwnerMeshes {
  /** Rendered and lit meshes (one per material). */
  visible: Mesh[];
  /** Invisible collider proxies (stair slabs, railing colliders), for the navmesh only. */
  hidden: Mesh[];
}

/**
 * Turns greybox pieces into the static level: visible pieces are merged into one mesh per owner × material (UVs in
 * world metres, frozen world matrix), every colliding piece becomes a box in one static Havok compound per owner, and
 * colliding pieces also go into meshes handed to the navmesh (`navigable`). `LevelBuilder` hands over pieces after
 * `OverlapResolver`, so the visible ones never overlap (z-fighting) and the colliders are invisible copies of what the
 * builders made. Box faces are axis-aligned flat quads, so
 * the merge keeps the flat-shaded look.
 */
export class StaticGeometry {
  readonly owners = new Map<string, OwnerMeshes>();
  /** Meshes made of colliding pieces (visible or not): input for the navmesh. */
  readonly navigable: Mesh[] = [];
  readonly bodies: PhysicsBody[] = [];

  private constructor(private readonly scene: Scene) {}

  static build(scene: Scene, physics: Physics, pieces: PieceList, material: (id: string) => Material): StaticGeometry {
    const geometry = new StaticGeometry(scene);
    type Group = {
      owner: string;
      material: string;
      boxes: BoxPiece[];
      quads: QuadPiece[];
      visible: boolean;
      collide: boolean;
      navigable: boolean;
      pickable: boolean;
    };
    const groups = new Map<string, Group>();
    const group = (owner: string, mat: string, visible: boolean, collide: boolean, navigable: boolean, pickable: boolean) => {
      const hidden = navigable ? COLLIDERS : NON_NAVIGABLE_COLLIDERS;
      const key = `${owner}|${visible ? mat : hidden}|${visible}|${collide}|${pickable}`;
      let entry = groups.get(key);
      if (entry === undefined) {
        entry = { owner, material: visible ? mat : hidden, boxes: [], quads: [], visible, collide, navigable, pickable };
        groups.set(key, entry);
      }
      return entry;
    };
    for (const box of pieces.boxes) {
      // Colliders are navmesh input unless marked otherwise (railings); visible colliders do not exist after the resolver.
      if (box.visible || box.collide) {
        group(box.owner, box.material, box.visible, box.collide, box.visible || box.navigable !== false, box.pickable !== false).boxes.push(box);
      }
    }
    for (const quad of pieces.quads) group(quad.owner, quad.material, true, false, true, quad.pickable !== false).quads.push(quad);

    for (const entry of groups.values()) {
      const data = [...entry.boxes.map((b) => StaticGeometry.boxData(b)), ...entry.quads.map((q) => StaticGeometry.quadData(q))];
      const merged = data[0]!;
      if (data.length > 1) merged.merge(data.slice(1), true);
      const mesh = new Mesh(`level:${entry.owner}:${entry.material}${entry.pickable ? "" : DETAIL_SUFFIX}`, scene);
      merged.applyToMesh(mesh);
      mesh.freezeWorldMatrix();
      if (!entry.pickable) mesh.isPickable = false;
      const owned = geometry.ownerMeshes(entry.owner);
      if (entry.visible) {
        const mat = material(entry.material);
        if (entry.quads.length > 0) mat.backFaceCulling = false;
        mesh.material = mat;
        owned.visible.push(mesh);
      } else {
        mesh.isVisible = false;
        mesh.isPickable = false;
        owned.hidden.push(mesh);
      }
      if (entry.collide && entry.navigable) geometry.navigable.push(mesh);
    }
    geometry.colliders(physics, pieces.boxes.filter((b) => b.collide));
    return geometry;
  }

  /**
   * The rendered pieces as audit surfaces, grouped like the merged meshes (owner × material), without the engine
   * scene (data test of `GeometryAudit`). `twoSided(material)` says whether the material draws back faces.
   */
  static auditSurfaces(pieces: PieceList, twoSided: (material: string) => boolean): AuditSurface[] {
    const groups = new Map<string, { owner: string; material: string; data: VertexData[]; quads: boolean }>();
    const add = (owner: string, material: string, data: VertexData, quad: boolean) => {
      const key = `${owner}|${material}`;
      let entry = groups.get(key);
      if (entry === undefined) {
        entry = { owner, material, data: [], quads: false };
        groups.set(key, entry);
      }
      entry.data.push(data);
      entry.quads ||= quad;
    };
    for (const box of pieces.boxes) if (box.visible) add(box.owner, box.material, StaticGeometry.boxData(box), false);
    for (const quad of pieces.quads) add(quad.owner, quad.material, StaticGeometry.quadData(quad), true);
    return [...groups.values()].map((entry) => {
      const merged = entry.data[0]!;
      if (entry.data.length > 1) merged.merge(entry.data.slice(1), true);
      return {
        mesh: `level:${entry.owner}:${entry.material}`,
        material: entry.material,
        owner: entry.owner,
        twoSided: entry.quads || twoSided(entry.material),
        positions: merged.positions!,
        indices: merged.indices!,
      };
    });
  }

  /** Triangles of the rendered meshes of an owner. */
  triangles(owner: string): number {
    return (this.owners.get(owner)?.visible ?? []).reduce((sum, mesh) => sum + mesh.getTotalIndices() / XYZ, 0);
  }

  private ownerMeshes(owner: string): OwnerMeshes {
    let owned = this.owners.get(owner);
    if (owned === undefined) {
      owned = { visible: [], hidden: [] };
      this.owners.set(owner, owned);
    }
    return owned;
  }

  /** One static compound body per owner, a box shape per colliding piece. */
  private colliders(physics: Physics, boxes: BoxPiece[]): void {
    const byOwner = new Map<string, BoxPiece[]>();
    for (const box of boxes) byOwner.set(box.owner, [...(byOwner.get(box.owner) ?? []), box]);
    const material = { friction: physics.data.staticFriction, restitution: physics.data.restitution };
    for (const [owner, list] of byOwner) {
      const node = new TransformNode(`level:${owner}:body`, this.scene);
      const container = new PhysicsShapeContainer(this.scene);
      for (const box of list) {
        const shape = new PhysicsShapeBox(
          new Vector3(box.center.x, box.center.y, box.center.z),
          Quaternion.RotationYawPitchRoll(box.yaw ?? 0, box.pitch ?? 0, box.roll ?? 0),
          new Vector3(box.size.x, box.size.y, box.size.z),
          this.scene,
        );
        shape.material = material;
        container.addChild(shape);
      }
      container.material = material;
      const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
      body.shape = container;
      this.bodies.push(body);
    }
  }

  /** A box in world space with UVs in metres projected along the face's dominant axis. */
  private static boxData(box: BoxPiece): VertexData {
    const data = CreateBoxVertexData({ width: box.size.x, height: box.size.y, depth: box.size.z });
    const matrix = Matrix.Compose(
      Vector3.One(),
      Quaternion.RotationYawPitchRoll(box.yaw ?? 0, box.pitch ?? 0, box.roll ?? 0),
      new Vector3(box.center.x, box.center.y, box.center.z),
    );
    data.transform(matrix);
    const positions = data.positions!;
    const normals = data.normals!;
    const uvs = new Array<number>((positions.length / XYZ) * UV_PER_VERTEX);
    for (let v = 0; v < positions.length / XYZ; v++) {
      const [x, y, z] = [positions[v * XYZ]!, positions[v * XYZ + 1]!, positions[v * XYZ + 2]!];
      const [nx, ny, nz] = [Math.abs(normals[v * XYZ]!), Math.abs(normals[v * XYZ + 1]!), Math.abs(normals[v * XYZ + 2]!)];
      const [u, w] = ny >= nx && ny >= nz ? [x, z] : nx >= nz ? [z, y] : [x, y];
      uvs[v * UV_PER_VERTEX] = u;
      uvs[v * UV_PER_VERTEX + 1] = w;
    }
    data.uvs = uvs;
    return data;
  }

  /** A unit-UV quad facing `quad.facing`. */
  private static quadData(quad: QuadPiece): VertexData {
    const data = new VertexData();
    data.positions = quad.corners.flatMap((c) => [c.x, c.y, c.z]);
    data.indices = [...QUAD_INDICES];
    data.uvs = [...QUAD_UVS];
    data.normals = quad.corners.flatMap(() => [quad.facing.x, quad.facing.y, quad.facing.z]);
    return data;
  }
}
