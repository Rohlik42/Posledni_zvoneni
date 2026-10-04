import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { DamageTargets } from "../../core/DamageTargets";
import { TriangleGrid } from "./TriangleGrid";

/** Slack (m) of the bounding-box pre-test, so rounding never rejects a mesh the exact test would hit. */
const BOX_SLACK = 0.01;
/** Moving groups with at most this many meshes (a door, a debris piece) re-read their boxes every step. */
const EAGER_GROUP_MESHES = 8;
/**
 * Larger moving groups (a teacher: ~70 parts swaying in place) re-read every `LAZY_REFRESH_STEPS` steps, or at once when
 * a ray passes their last box widened by `LAZY_SLACK` m — far more than such a group moves in that time.
 */
const LAZY_REFRESH_STEPS = 10;
const LAZY_SLACK = 0.25;
/** Floats per box in the cache: min x, y, z, max x, y, z. */
const BOX_FLOATS = 6;
/** Direction components smaller than this are treated as parallel to a slab. */
const PARALLEL = 1e-9;
/** Frozen meshes with at least this many triangles get a `TriangleGrid` for the exact test. */
const GRID_MIN_TRIANGLES = 48;
const XYZ = 3;

/** Distances closer than this count as the same answer in `selfCheck` (float32 boxes vs Babylon's float64 math). */
const CHECK_TOLERANCE = 1e-3;
/** Normals agree when |cos| of their angle is at least this (`probe` turns them towards the ray). */
const NORMAL_AGREEMENT = 0.99;

/** Result of `selfCheck`: rays compared with `scene.pickWithRay` and those that answered differently. */
export interface SightCheck {
  rays: number;
  hits: number;
  mismatches: { origin: number[]; direction: number[]; length: number; ours: number | null; babylon: number | null; mesh: string | null }[];
}

/** The closest blocking hit of a ray. */
interface Hit {
  distance: number;
  /** World normal of the hit surface (either side), or null when it cannot be told. */
  normal: () => Vector3 | null;
}

/**
 * Line-of-sight queries against the rendered scene for AI vision and cover: visible, pickable meshes of the world
 * block the view; robots and other damageable things, effects (not pickable) and the player's viewmodel (its own
 * rendering group) do not, so robots see past each other and the player's gun never hides the player.
 *
 * Phase 21 (performance): drones cast several rays per fixed step, and `scene.pickWithRay` runs a predicate and a
 * world-matrix inversion over every mesh of the scene for each one (a third of the frame in the start room). Here the
 * world bounding boxes of all pickable meshes without a damageable owner are cached in flat arrays, grouped by root
 * node with a box around each group (rebuilt when a mesh is added or removed; boxes of groups that can move are
 * refreshed after `beginStep` once per fixed step — large animated groups lazily, see `LAZY_REFRESH_STEPS` — frozen
 * level geometry never moves). A ray tests the boxes first and runs
 * the visibility checks and the exact test only on boxes it passes through, nearest first; large frozen meshes use a
 * `TriangleGrid` instead of walking all their triangles. A mesh whose box the ray misses cannot be hit, so the answers
 * are those of `pickWithRay` with the predicate (`selfCheck`, `__game.enemies.sightCheck`).
 */
export class LineOfSight {
  private casts = 0;
  /** Candidate meshes, the members of each group (same root node) next to each other. */
  private meshes: AbstractMesh[] = [];
  /** Position of each candidate in `scene.meshes` (ties go to the earlier one, as in `pickWithRay`). */
  private sceneOrder = new Int32Array(0);
  /** Group g holds `meshes[groupStart[g] .. groupStart[g + 1])`. */
  private groupStart = new Int32Array(1);
  /** Groups with a mesh whose world matrix is not frozen (their boxes are re-read every step). */
  private moving: number[] = [];
  private boxes = new Float32Array(0);
  private groupBoxes = new Float32Array(0);
  private dirty = true;
  /** Fixed steps begun so far, and the step each group's boxes were last read in. */
  private step = 0;
  private groupReadStep = new Int32Array(0);
  /** Moving groups too large to re-read every step (see `LAZY_REFRESH_STEPS`). */
  private lazy = new Uint8Array(0);
  private refreshedStep = -1;
  /** Boxes a ray passes through (reused between rays). */
  private readonly hits: { index: number; near: number }[] = [];
  /** Triangle grids of large frozen meshes (built on their first exact test); null = not worth one / unreadable. */
  private readonly grids = new WeakMap<AbstractMesh, TriangleGrid | null>();

  constructor(private readonly scene: Scene) {
    scene.onNewMeshAddedObservable.add(() => (this.dirty = true));
    scene.onMeshRemovedObservable.add(() => (this.dirty = true));
  }

  /** Start of a fixed step: boxes of meshes that can move are re-read before the next ray. */
  beginStep(): void {
    this.step += 1;
  }

  /** Distance to the first blocking surface along `direction` (normalised) within `length`, or null. */
  firstHit(origin: Vector3, direction: Vector3, length: number): number | null {
    const pick = this.pick(origin, direction, length);
    return pick === null ? null : pick.distance;
  }

  /**
   * The first blocking surface along `direction` (normalised) within `length`: its distance and world normal (facing
   * the ray). Drones steer and collide with it.
   */
  probe(origin: Vector3, direction: Vector3, length: number): { distance: number; normal: Vector3 } | null {
    const pick = this.pick(origin, direction, length);
    if (pick === null) return null;
    const normal = pick.normal() ?? direction.scale(-1);
    if (Vector3.Dot(normal, direction) > 0) normal.scaleInPlace(-1);
    return { distance: pick.distance, normal };
  }

  /** True when something blocks the straight line between `from` and `to`. */
  blocked(from: Vector3, to: Vector3): boolean {
    const delta = to.subtract(from);
    const length = delta.length();
    if (length < Number.EPSILON) return false;
    return this.firstHit(from, delta.scaleInPlace(1 / length), length) !== null;
  }

  /**
   * Regression check of the cached search (phase 21): `rays` rays from `origins` in seeded random directions, each
   * answered by `firstHit` and by Babylon's `pickWithRay` with the same predicate; distances must agree.
   */
  selfCheck(origins: readonly Vector3[], rays: number, length: number, seed: number): SightCheck {
    let state = seed >>> 0 || 1;
    const random = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const result: SightCheck = { rays: 0, hits: 0, mismatches: [] };
    for (let i = 0; i < rays && origins.length > 0; i++) {
      const origin = origins[i % origins.length]!;
      const z = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      const direction = new Vector3(r * Math.cos(angle), z, r * Math.sin(angle));
      const probe = this.probe(origin, direction, length);
      const ours = probe?.distance ?? null;
      const pick = this.scene.pickWithRay(new Ray(origin, direction, length), (mesh) => this.blocks(mesh));
      const babylon = pick?.hit === true ? pick.distance : null;
      result.rays += 1;
      if (babylon !== null) result.hits += 1;
      const babylonNormal = pick?.hit === true ? pick.getNormal(true, true) : null;
      const sameNormal = probe === null || babylonNormal === null || Math.abs(Vector3.Dot(probe.normal, babylonNormal)) >= NORMAL_AGREEMENT;
      const same = (ours === null || babylon === null ? ours === babylon : Math.abs(ours - babylon) <= CHECK_TOLERANCE) && sameNormal;
      if (!same) result.mismatches.push({ origin: origin.asArray(), direction: direction.asArray(), length, ours, babylon, mesh: pick?.pickedMesh?.name ?? null });
    }
    return result;
  }

  /** Rays cast so far (perf check: vision is throttled by `senses.visionInterval`). */
  get castCount(): number {
    return this.casts;
  }

  /**
   * The closest blocking hit (ties keep scene order, as `pickWithRay`), or null. Group boxes first (a teacher's or a
   * door's parts share one), then the boxes of the meshes inside; the meshes whose boxes the segment passes are tested
   * nearest first, and the search stops at the first box that starts beyond the best hit.
   */
  private pick(origin: Vector3, direction: Vector3, length: number): Hit | null {
    this.casts++;
    this.refresh();
    const { boxes, groupBoxes, groupStart, meshes } = this;
    const hits = this.hits;
    hits.length = 0;
    for (let g = 0; g + 1 < groupStart.length; g++) {
      const from = groupStart[g]!;
      const to = groupStart[g + 1]!;
      if (this.lazy[g] === 1 && this.groupReadStep[g] !== this.step) {
        // A large group read in an earlier step: a generous test first, the exact one only on fresh boxes.
        if (LineOfSight.slab(groupBoxes, g * BOX_FLOATS, origin, direction, length, LAZY_SLACK) < 0) continue;
        this.readGroup(g);
      }
      const groupNear = LineOfSight.slab(groupBoxes, g * BOX_FLOATS, origin, direction, length, BOX_SLACK);
      if (groupNear < 0) continue;
      if (to - from === 1) {
        hits.push({ index: from, near: groupNear });
        continue;
      }
      for (let i = from; i < to; i++) {
        const near = LineOfSight.slab(boxes, i * BOX_FLOATS, origin, direction, length, BOX_SLACK);
        if (near >= 0) hits.push({ index: i, near });
      }
    }
    if (hits.length === 0) return null;
    const order = this.sceneOrder;
    hits.sort((a, b) => a.near - b.near || order[a.index]! - order[b.index]!);
    let ray: Ray | null = null;
    let best: Hit | null = null;
    let bestOrder = -1;
    for (const { index, near } of hits) {
      if (best !== null && near > best.distance + BOX_SLACK) break;
      const mesh = meshes[index]!;
      if (!this.blocks(mesh)) continue;
      let hit: Hit | null;
      const grid = this.grid(mesh);
      if (grid !== null) {
        const h = grid.intersect(origin, direction, length);
        hit = h === null ? null : { distance: h.distance, normal: () => h.normal };
      } else {
        ray ??= new Ray(origin, direction, length);
        const info =
          mesh.hasThinInstances && (mesh as { thinInstanceEnablePicking?: boolean }).thinInstanceEnablePicking === true
            ? this.scene.pickWithRay(ray, (m) => m === mesh)
            : ray.intersectsMesh(mesh, false);
        hit = info?.hit === true ? { distance: info.distance, normal: () => info.getNormal(true, true) } : null;
      }
      if (hit === null) continue;
      if (best === null || hit.distance < best.distance || (hit.distance === best.distance && order[index]! < bestOrder)) {
        best = hit;
        bestOrder = order[index]!;
      }
    }
    return best;
  }

  /** Where the segment from `o` along unit `d` within `length` enters the box at `b` (widened by the slack), or −1. */
  private static slab(boxes: Float32Array, b: number, o: Vector3, d: Vector3, length: number, slack: number): number {
    // Per axis: [near, far] shrinks to where the segment is inside both slabs (no allocation: called per box per ray).
    let near = 0;
    let far = length;
    for (let a = 0; a < XYZ; a++) {
      const p = a === 0 ? o.x : a === 1 ? o.y : o.z;
      const v = a === 0 ? d.x : a === 1 ? d.y : d.z;
      const lo = boxes[b + a]! - slack;
      const hi = boxes[b + a + XYZ]! + slack;
      if (Math.abs(v) < PARALLEL) {
        if (p < lo || p > hi) return -1;
        continue;
      }
      const t1 = (lo - p) / v;
      const t2 = (hi - p) / v;
      near = Math.max(near, Math.min(t1, t2));
      far = Math.min(far, Math.max(t1, t2));
      if (near > far) return -1;
    }
    return near;
  }

  /**
   * Rebuilds the cache after meshes came or went (meshes ordered by root node, so each group is one run); re-reads the
   * boxes of groups that can move once per step.
   */
  private refresh(): void {
    if (this.dirty) {
      this.dirty = false;
      this.refreshedStep = this.step;
      // Meshes that are never pickable (effects, pickups, the weapon in hand) or have an owner never block; the flags are
      // checked again per ray, so this only shortens the list.
      const byRoot = new Map<Node, { mesh: AbstractMesh; order: number }[]>();
      this.scene.meshes.forEach((mesh, order) => {
        if (!mesh.isPickable || mesh.renderingGroupId !== 0 || DamageTargets.find(mesh) !== null) return;
        let root: Node = mesh;
        while (root.parent !== null) root = root.parent;
        const members = byRoot.get(root);
        if (members === undefined) byRoot.set(root, [{ mesh, order }]);
        else members.push({ mesh, order });
      });
      const groups = [...byRoot.values()];
      this.meshes = groups.flatMap((members) => members.map((m) => m.mesh));
      this.sceneOrder = Int32Array.from(groups.flatMap((members) => members.map((m) => m.order)));
      this.groupStart = new Int32Array(groups.length + 1);
      groups.forEach((members, g) => (this.groupStart[g + 1] = this.groupStart[g]! + members.length));
      this.boxes = new Float32Array(this.meshes.length * BOX_FLOATS);
      this.groupBoxes = new Float32Array(groups.length * BOX_FLOATS);
      this.moving = [];
      this.groupReadStep = new Int32Array(groups.length);
      this.lazy = new Uint8Array(groups.length);
      for (let g = 0; g < groups.length; g++) {
        if (groups[g]!.some((m) => !m.mesh.isWorldMatrixFrozen)) {
          this.moving.push(g);
          if (groups[g]!.length > EAGER_GROUP_MESHES) this.lazy[g] = 1;
        }
        this.readGroup(g);
      }
      return;
    }
    if (this.refreshedStep !== this.step) {
      this.refreshedStep = this.step;
      for (const g of this.moving) {
        if (this.lazy[g] === 0 || this.step - this.groupReadStep[g]! >= LAZY_REFRESH_STEPS) this.readGroup(g);
      }
    }
  }

  /** Boxes of a group's meshes and their union. */
  private readGroup(g: number): void {
    this.groupReadStep[g] = this.step;
    const from = this.groupStart[g]!;
    const to = this.groupStart[g + 1]!;
    const u = g * BOX_FLOATS;
    for (let a = 0; a < XYZ; a++) {
      this.groupBoxes[u + a] = Infinity;
      this.groupBoxes[u + a + XYZ] = -Infinity;
    }
    for (let i = from; i < to; i++) {
      this.readBox(i);
      const b = i * BOX_FLOATS;
      for (let a = 0; a < XYZ; a++) {
        this.groupBoxes[u + a] = Math.min(this.groupBoxes[u + a]!, this.boxes[b + a]!);
        this.groupBoxes[u + a + XYZ] = Math.max(this.groupBoxes[u + a + XYZ]!, this.boxes[b + a + XYZ]!);
      }
    }
  }

  private readBox(i: number): void {
    const mesh = this.meshes[i]!;
    mesh.computeWorldMatrix();
    const box = mesh.getBoundingInfo().boundingBox;
    const b = i * BOX_FLOATS;
    this.boxes[b] = box.minimumWorld.x;
    this.boxes[b + 1] = box.minimumWorld.y;
    this.boxes[b + 2] = box.minimumWorld.z;
    this.boxes[b + 3] = box.maximumWorld.x;
    this.boxes[b + 4] = box.maximumWorld.y;
    this.boxes[b + 5] = box.maximumWorld.z;
  }

  /** A triangle grid for a large mesh that never moves (frozen world matrix), else null (Babylon's exact test). */
  private grid(mesh: AbstractMesh): TriangleGrid | null {
    if (!mesh.isWorldMatrixFrozen || mesh.hasThinInstances || mesh.getTotalIndices() / XYZ < GRID_MIN_TRIANGLES) return null;
    let grid = this.grids.get(mesh);
    if (grid === undefined) {
      grid = TriangleGrid.build(mesh);
      this.grids.set(mesh, grid);
    }
    return grid;
  }

  /** Visibility flags, then the owner lookup (a mesh may get an owner after it was added). */
  private blocks(mesh: AbstractMesh): boolean {
    if (!mesh.isPickable || !mesh.isVisible || mesh.visibility <= 0 || mesh.renderingGroupId !== 0) return false;
    if (mesh.isDisposed() || !mesh.isEnabled()) return false;
    return DamageTargets.find(mesh) === null;
  }
}

