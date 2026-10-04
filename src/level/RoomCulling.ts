import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { TestHooks } from "../core/TestHooks";
import type { QualityPresetData } from "../rendering/QualityConfig";
import type { QualityTarget } from "../rendering/QualityManager";
import type { RenderingData } from "../rendering/RenderingConfig";
import type { Level } from "./Level";
import type { LevelData } from "./LevelTypes";

const MS_PER_SECOND = 1000;

export type CullingSettings = RenderingData["culling"];

/** `window.__game.culling` (phase 21). */
export interface CullingTestApi {
  readonly enabled: boolean;
  /** Passages from the player's room whose contents still render (`rendering.json`, quality presets override). */
  readonly depth: number;
  setEnabled: (enabled: boolean) => void;
  /** Rooms rendered from the player's room (empty before the first update). */
  visibleRooms: () => string[];
  /** Meshes left out of rendering now. */
  culled: () => number;
  /** Room each culled group is in, by group root name (debugging). */
  hiddenGroups: () => Record<string, string>;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    culling: CullingTestApi;
  }
}

/** Meshes sharing one root node (a robot, a teacher, a pickup) and the room they were last seen in. */
interface Group {
  root: Node;
  meshes: AbstractMesh[];
  room: string | null;
}

/**
 * Culling by rooms (phase 21, performance): robots, teachers, pickups, props and doors in rooms the player cannot see
 * into are not even considered for rendering. From the player's room the potentially visible rooms are those at most
 * `depth` passages away (doors, openings, stairs — `level.json`), whatever the doors' state. Things outside every room
 * (a door leaf in its wall gap, a projectile in flight) always render; the level shell (walls, floors, windows) always
 * renders too, so nothing seen through a window disappears. Only the render candidate list changes
 * (`scene.getActiveMeshCandidates`): visibility flags, picking, AI vision and shadows are untouched, so game logic is the
 * same. Rooms of moving things are re-read every `interval` s; new and removed meshes rebuild the list on the next frame.
 */
export class RoomCulling implements QualityTarget {
  private reachable: Map<string, Set<string>>;
  private depthValue: number;
  private readonly shell = new Set<AbstractMesh>();
  private readonly added: Observer<AbstractMesh>;
  private readonly removed: Observer<AbstractMesh>;
  private readonly frame: Observer<Scene>;
  private readonly candidates: { data: AbstractMesh[]; length: number } = { data: [], length: 0 };
  private readonly defaultCandidates: Scene["getActiveMeshCandidates"];
  private groups: Group[] = [];
  private eyeRoom: string | null = null;
  private timerMs = 0;
  private dirtyGroups = true;
  private dirtyList = true;
  private enabledValue: boolean;

  constructor(
    private readonly scene: Scene,
    private readonly level: Level,
    private readonly settings: CullingSettings,
    private readonly eye: () => Vector3,
    private readonly floorTolerance: number,
  ) {
    this.enabledValue = settings.enabled;
    this.depthValue = settings.depth;
    this.reachable = RoomCulling.reachableRooms(level.layout.level, settings.depth);
    for (const owned of level.geometry.owners.values()) for (const mesh of owned.visible) this.shell.add(mesh);
    this.defaultCandidates = scene.getActiveMeshCandidates;
    scene.getActiveMeshCandidates = () => (this.enabledValue ? this.list() : this.defaultCandidates.call(scene));
    const dirty = (): void => {
      this.dirtyGroups = true;
      this.dirtyList = true;
    };
    this.added = scene.onNewMeshAddedObservable.add(dirty);
    this.removed = scene.onMeshRemovedObservable.add(dirty);
    this.frame = scene.onBeforeRenderObservable.add(() => this.update());
    const culling = this;
    TestHooks.register("culling", {
      get enabled() {
        return culling.enabledValue;
      },
      get depth() {
        return culling.depthValue;
      },
      setEnabled: (on) => culling.setEnabled(on),
      visibleRooms: () => culling.visibleRooms,
      culled: () => culling.culledCount,
      hiddenGroups: () => culling.hiddenGroups(),
    });
  }

  /**
   * Rooms seen from each room: itself and every room at most `depth` passages away (a door or opening joins its two
   * rooms, a stair its bottom and top room).
   */
  static reachableRooms(level: LevelData, depth: number): Map<string, Set<string>> {
    const neighbours = new Map<string, Set<string>>(level.rooms.map((r) => [r.id, new Set<string>()]));
    const link = (a: string, b: string): void => {
      neighbours.get(a)?.add(b);
      neighbours.get(b)?.add(a);
    };
    for (const door of level.doors) link(door.rooms[0], door.rooms[1]);
    for (const stair of level.stairs) link(stair.bottomRoom, stair.topRoom);
    const reachable = new Map<string, Set<string>>();
    for (const room of level.rooms) {
      const seen = new Set([room.id]);
      let front = [room.id];
      for (let step = 0; step < depth; step++) {
        const next: string[] = [];
        for (const id of front) for (const n of neighbours.get(id) ?? []) if (!seen.has(n)) (seen.add(n), next.push(n));
        front = next;
      }
      reachable.set(room.id, seen);
    }
    return reachable;
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  get depth(): number {
    return this.depthValue;
  }

  /** How many passages away contents still render (quality presets: fewer on the low one). */
  setDepth(depth: number): void {
    if (depth === this.depthValue) return;
    this.depthValue = depth;
    this.reachable = RoomCulling.reachableRooms(this.level.layout.level, depth);
    this.dirtyList = true;
  }

  applyQuality(preset: QualityPresetData): void {
    this.setDepth(preset.cullingDepth);
  }

  setEnabled(enabled: boolean): void {
    this.enabledValue = enabled;
    this.dirtyList = true;
  }

  /** The room the player's eye was last in and the rooms rendered from it. */
  get visibleRooms(): string[] {
    return this.eyeRoom === null ? [] : [...(this.reachable.get(this.eyeRoom) ?? [])];
  }

  /** Meshes left out of rendering right now (0 when off). */
  get culledCount(): number {
    if (!this.enabledValue) return 0;
    return this.scene.meshes.length - this.list().length;
  }

  private hiddenGroups(): Record<string, string> {
    const visible = this.eyeRoom === null ? null : this.reachable.get(this.eyeRoom);
    const out: Record<string, string> = {};
    if (!this.enabledValue || visible === null || visible === undefined) return out;
    for (const group of this.groups) if (group.room !== null && !visible.has(group.room)) out[group.root.name] = group.room;
    return out;
  }

  dispose(): void {
    this.scene.getActiveMeshCandidates = this.defaultCandidates;
    this.scene.onNewMeshAddedObservable.remove(this.added);
    this.scene.onMeshRemovedObservable.remove(this.removed);
    this.scene.onBeforeRenderObservable.remove(this.frame);
  }

  private update(): void {
    if (!this.enabledValue) return;
    this.timerMs -= this.scene.getEngine().getDeltaTime();
    if (this.timerMs > 0 && !this.dirtyGroups) return;
    this.timerMs = this.settings.interval * MS_PER_SECOND;
    if (this.dirtyGroups) this.regroup();
    const eyeRoom = this.level.roomAt(this.eye(), this.floorTolerance);
    // In a wall gap (a doorway) the last room stays: both rooms of a door are in each other's set anyway.
    if (eyeRoom !== null && eyeRoom !== this.eyeRoom) {
      this.eyeRoom = eyeRoom;
      this.dirtyList = true;
    }
    for (const group of this.groups) {
      const room = this.level.roomAt(RoomCulling.center(group), this.floorTolerance);
      if (room !== group.room) {
        group.room = room;
        this.dirtyList = true;
      }
    }
  }

  private list(): { data: AbstractMesh[]; length: number } {
    if (this.dirtyList) {
      this.dirtyList = false;
      if (this.dirtyGroups) this.regroup();
      const visible = this.eyeRoom === null ? null : this.reachable.get(this.eyeRoom) ?? null;
      const hidden = new Set<AbstractMesh>();
      if (visible !== null) {
        for (const group of this.groups) {
          if (group.room !== null && !visible.has(group.room)) for (const mesh of group.meshes) hidden.add(mesh);
        }
      }
      this.candidates.data = hidden.size === 0 ? [...this.scene.meshes] : this.scene.meshes.filter((mesh) => !hidden.has(mesh));
      this.candidates.length = this.candidates.data.length;
    }
    return this.candidates;
  }

  /** Groups every mesh that is not the level shell, the sky or drawn on top (the weapon in hand) by its root node. */
  private regroup(): void {
    this.dirtyGroups = false;
    const byRoot = new Map<Node, Group>();
    for (const mesh of this.scene.meshes) {
      if (this.shell.has(mesh) || mesh.infiniteDistance || mesh.renderingGroupId !== 0) continue;
      let root: Node = mesh;
      while (root.parent !== null) root = root.parent;
      let group = byRoot.get(root);
      if (group === undefined) {
        group = { root, meshes: [], room: null };
        byRoot.set(root, group);
      }
      group.meshes.push(mesh);
    }
    this.groups = [...byRoot.values()];
    for (const group of this.groups) group.room = this.level.roomAt(RoomCulling.center(group), this.floorTolerance);
    this.dirtyList = true;
  }

  /** Where a group is: its root's position, or the centre of a merged mesh's bounds (merged meshes sit at the origin). */
  private static center(group: Group): Vector3 {
    const root = group.root;
    if (RoomCulling.isMesh(root) && root.getTotalVertices() > 0) {
      root.computeWorldMatrix();
      return root.getBoundingInfo().boundingBox.centerWorld;
    }
    const node = root as Node & { getAbsolutePosition?: () => Vector3 };
    return node.getAbsolutePosition?.() ?? group.meshes[0]!.getBoundingInfo().boundingBox.centerWorld;
  }

  private static isMesh(node: Node): node is AbstractMesh {
    const mesh = node as unknown as Partial<AbstractMesh>;
    return typeof mesh.getTotalVertices === "function" && typeof mesh.getBoundingInfo === "function";
  }
}
