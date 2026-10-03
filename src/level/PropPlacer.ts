import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
// Side effect: thin instance methods on Mesh.
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { BlueprintBuilder } from "../rendering/BlueprintBuilder";
import type { LevelLayout } from "./LevelLayout";
import { PropLayout, type PropInstance } from "./PropLayout";
import type { PropsData } from "./PropsConfig";

const FLOATS_PER_MATRIX = 16;
const VERTICES_PER_TRIANGLE = 3;
const MESH_PREFIX = "prop";

/** What `PropPlacer.place` built: meshes per room (for room lights) and the instances behind them. */
export interface PlacedProps {
  readonly props: PropLayout;
  /** Room id → its prop meshes (one per blueprint × variant × material, every copy a thin instance). */
  readonly meshesByRoom: ReadonlyMap<string, Mesh[]>;
  /** Drawn triangles of a room's props (mesh triangles × thin instances), or of all props. */
  triangles(roomId?: string): number;
  dispose(): void;
}

/**
 * Builds the props of `data/props.json` into the level (phase 15; phase 16 calls it from the level build). Every room ×
 * blueprint × variant is built once from its blueprint, merged into one mesh per material and drawn as thin instances
 * at the copies' matrices: a classroom of 16 chairs costs one draw call per chair material. Meshes are grouped by room
 * so `RoomLighting.attach(meshes, [room])` lights them with their room's lamps. Props do not collide and are not
 * pickable; `PropLayout` footprints are the place to start if they should (`PropInstance.footprint`).
 */
export class PropPlacer {
  static place(scene: Scene, layout: LevelLayout, data?: PropsData): PlacedProps {
    const props = new PropLayout(layout, data);
    const meshesByRoom = new Map<string, Mesh[]>();
    const groups = new Map<string, PropInstance[]>();
    for (const instance of props.instances) {
      const key = `${instance.room}|${instance.blueprint}|${instance.variant}`;
      const list = groups.get(key);
      if (list === undefined) groups.set(key, [instance]);
      else list.push(instance);
    }
    for (const instances of groups.values()) {
      const first = instances[0]!;
      const meshes = PropPlacer.build(scene, first, PropPlacer.matrices(instances));
      const list = meshesByRoom.get(first.room) ?? [];
      list.push(...meshes);
      meshesByRoom.set(first.room, list);
    }
    const all = (): Mesh[] => [...meshesByRoom.values()].flat();
    return {
      props,
      meshesByRoom,
      triangles: (roomId) => PropPlacer.drawnTriangles(roomId === undefined ? all() : (meshesByRoom.get(roomId) ?? [])),
      dispose: () => {
        for (const mesh of all()) mesh.dispose(false, false);
        meshesByRoom.clear();
      },
    };
  }

  /** One merged mesh per material of the blueprint, drawn at every matrix in `buffer`. */
  private static build(scene: Scene, instance: PropInstance, buffer: Float32Array): Mesh[] {
    const name = `${MESH_PREFIX}:${instance.room}:${instance.blueprint}`;
    const built = BlueprintBuilder.build(scene, instance.blueprint, { variant: instance.variant, name });
    const byMaterial = new Map<number, Mesh[]>();
    for (const mesh of built.meshes) {
      const id = mesh.material?.uniqueId ?? -1;
      const list = byMaterial.get(id);
      if (list === undefined) byMaterial.set(id, [mesh]);
      else list.push(mesh);
    }
    const result: Mesh[] = [];
    for (const meshes of byMaterial.values()) {
      const material = meshes[0]!.material;
      for (const mesh of meshes) mesh.computeWorldMatrix(true);
      // Bakes each part's transform (model space; the root sits at the origin) into one vertex buffer.
      const merged = Mesh.MergeMeshes(meshes, false, true);
      if (merged === null) continue;
      merged.name = `${name}:${material?.name ?? "default"}`;
      merged.material = material;
      merged.parent = null;
      merged.isPickable = false;
      merged.thinInstanceSetBuffer("matrix", buffer, FLOATS_PER_MATRIX, true);
      merged.thinInstanceRefreshBoundingInfo(false);
      merged.freezeWorldMatrix();
      result.push(merged);
    }
    built.dispose();
    return result;
  }

  private static matrices(instances: readonly PropInstance[]): Float32Array {
    const buffer = new Float32Array(instances.length * FLOATS_PER_MATRIX);
    instances.forEach((instance, i) => {
      const { x, y, z } = instance.position;
      Matrix.Compose(Vector3.One(), Quaternion.RotationYawPitchRoll(instance.yaw, 0, 0), new Vector3(x, y, z)).copyToArray(buffer, i * FLOATS_PER_MATRIX);
    });
    return buffer;
  }

  private static drawnTriangles(meshes: readonly AbstractMesh[]): number {
    let triangles = 0;
    for (const mesh of meshes) {
      const copies = mesh instanceof Mesh ? Math.max(1, mesh.thinInstanceCount) : 1;
      triangles += (mesh.getTotalIndices() / VERTICES_PER_TRIANGLE) * copies;
    }
    return triangles;
  }
}
