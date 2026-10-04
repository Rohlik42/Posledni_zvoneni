import type { Light } from "@babylonjs/core/Lights/light";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "../core/Game";
import { LightExclusions } from "../rendering/LightExclusions";
import { PerformanceConfig } from "../rendering/PerformanceConfig";
import type { Level } from "./Level";

interface Tracked {
  meshes: () => readonly AbstractMesh[];
  position: () => Vector3;
  room: string | null;
  /**
   * Meshes lit now: its current meshes plus those that left it but still exist (a destroyed robot's parts flying as
   * debris, the weapon put away), so they keep their light count — and shader — until they are disposed.
   */
  lit: AbstractMesh[];
  litSet: Set<AbstractMesh>;
  /** The `dynamicLights.count` lights shining on it now: nearest of its room, padded with dark ones. */
  lights: Light[];
  /** Frames until the nearest lights are chosen again (rooms with more lights than `count`). */
  refreshIn: number;
}

/** Light lists whose `splice` re-checks only the removed meshes (`cheapRemoval`). */
const CHEAP_REMOVAL = new WeakSet<AbstractMesh[]>();

/** Dark padding lights sit here and reach nowhere (they only keep the light count of moving things constant). */
const PAD_POSITION = new Vector3(0, -1e4, 0);
const PAD_RANGE = 1e-3;

/**
 * Level point lights shine only on the meshes of their own room (`includedOnlyMeshes`, phase 9: no shadows, so a light
 * would otherwise reach through walls). Everything added to the level later must join those lists too, or it stays
 * unlit: door leaves and pickups are attached to their room once, moving things (robots, the weapon in hand) are
 * tracked and switch lights when they enter another room (checked every frame, re-linked only on a room change).
 * Extra lights (a key's glow) shine on their room's static meshes and on whatever is attached to or tracked in it.
 *
 * FEEDBACK 2026-10-04 (combat lag, also on Nízké on Windows): a moving thing is lit by exactly
 * `data/performance.json → dynamicLights.count` lights — the nearest of its room, padded with dark lights — so its
 * materials keep one shader in every room (a different light count is a different shader, compiled on the spot, which
 * stalls a frame for tens of ms on Windows). The light lists change without Babylon's per-call scene walk (see
 * `include`), and a changed mesh list (a wet spot on a robot, parts flying off) only moves the difference.
 */
export class RoomLighting {
  private readonly tracked = new Set<Tracked>();
  /** Meshes attached per room (static door leaves, pickups), so extra lights can include them. */
  private readonly attached = new Map<string, Set<AbstractMesh>>();
  private readonly extraLights = new Map<string, Light[]>();
  private readonly frameObserver: Observer<Scene>;
  /** Lights per moving thing, and how often the nearest are re-chosen (data/performance.json → dynamicLights). */
  private readonly lightCount: number;
  private readonly refreshFrames: number;
  /** Dark lights that fill up the light list of a moving thing in a room with fewer lights. */
  private readonly padding: PointLight[] = [];
  /** A mesh that is never drawn: an empty `includedOnlyMeshes` would mean „every mesh“, so each padding light keeps it. */
  private readonly anchor: Mesh;
  /** Meshes removed from the scene (disposed meshes leave the light lists at the next update). */
  private removedCount = 0;
  private seenRemoved = 0;
  private meshesRemoved = false;

  constructor(
    private readonly game: Game,
    private readonly level: Level,
  ) {
    const { dynamicLights } = PerformanceConfig.load();
    this.lightCount = dynamicLights.count;
    this.refreshFrames = dynamicLights.refreshFrames;
    this.anchor = new Mesh("room-lighting-anchor", game.scene);
    this.anchor.setEnabled(false);
    this.anchor.isPickable = false;
    for (let i = 0; i < this.lightCount; i++) {
      const light = new PointLight(`room-lighting-pad-${i}`, PAD_POSITION.clone(), game.scene);
      light.intensity = 0;
      light.range = PAD_RANGE;
      light.includedOnlyMeshes = [this.anchor];
      this.padding.push(light);
    }
    for (const light of [...level.lights, ...this.padding]) RoomLighting.cheapRemoval(light);
    this.frameObserver = game.scene.onBeforeRenderObservable.add(() => this.update());
    game.scene.onMeshRemovedObservable.add(() => (this.removedCount += 1));
  }

  /** The room a world point lies in (null outside the level). */
  roomAt(position: Vector3): string | null {
    return this.level.roomAt(position, this.level.layout.greybox.lights.dynamicFloorTolerance);
  }

  /** Lights shining into a room: its level lights and extra lights added there. */
  lightsFor(roomId: string): Light[] {
    return [...this.level.lightsFor(roomId), ...(this.extraLights.get(roomId) ?? [])];
  }

  /** Static meshes lit by the lights of `rooms` (a door leaf belongs to both rooms it joins). */
  attach(meshes: readonly AbstractMesh[], rooms: readonly string[]): void {
    for (const room of rooms) {
      let set = this.attached.get(room);
      if (set === undefined) {
        set = new Set();
        this.attached.set(room, set);
      }
      for (const mesh of meshes) set.add(mesh);
      RoomLighting.include(this.lightsFor(room), meshes);
    }
  }

  /** Removes attached meshes (a collected pickup) from every light. */
  detach(meshes: readonly AbstractMesh[]): void {
    for (const set of this.attached.values()) for (const mesh of meshes) set.delete(mesh);
    RoomLighting.exclude([...this.level.lights, ...[...this.extraLights.values()].flat()], meshes);
  }

  /** Moving meshes lit by the room they are in; `meshes` is asked again on every room change. Returns an untrack. */
  track(meshes: () => readonly AbstractMesh[], position: () => Vector3): () => void {
    // Wet spots and the like hanging on the thing stay out (`LightExclusions`).
    const lit = (): AbstractMesh[] => meshes().filter((mesh) => !LightExclusions.has(mesh));
    const entry: Tracked = { meshes: lit, position, room: null, lit: [], litSet: new Set(), lights: [], refreshIn: 0 };
    this.tracked.add(entry);
    this.relink(entry);
    return () => {
      this.unlink(entry);
      this.tracked.delete(entry);
    };
  }

  /** A light of something in a room (a key): it shines on the room's static, attached and tracked meshes. */
  addLight(light: Light, roomId: string): void {
    const list = this.extraLights.get(roomId) ?? [];
    list.push(light);
    this.extraLights.set(roomId, list);
    light.includedOnlyMeshes = [...this.level.roomMeshes(roomId), ...(this.attached.get(roomId) ?? [])];
    RoomLighting.cheapRemoval(light);
    // Moving things in the room choose their nearest lights again (the count stays the same).
    for (const entry of this.tracked) if (entry.room === roomId) this.relink(entry);
  }

  removeLight(light: Light): void {
    for (const [room, list] of this.extraLights) this.extraLights.set(room, list.filter((l) => l !== light));
  }

  /** Room of a tracked thing right now (tests). */
  trackedRooms(): (string | null)[] {
    return [...this.tracked].map((t) => t.room);
  }

  /** Lights shining on each tracked thing now (tests: always `dynamicLights.count`). */
  trackedLights(): number[] {
    return [...this.tracked].map((t) => t.lights.length);
  }

  dispose(): void {
    this.game.scene.onBeforeRenderObservable.remove(this.frameObserver);
    for (const entry of this.tracked) this.unlink(entry);
    this.tracked.clear();
    for (const light of this.padding) light.dispose();
    this.anchor.dispose();
  }

  private update(): void {
    this.meshesRemoved = this.removedCount !== this.seenRemoved;
    this.seenRemoved = this.removedCount;
    for (const entry of this.tracked) {
      const room = this.roomAt(entry.position());
      if (room !== entry.room) {
        this.relink(entry);
        continue;
      }
      const meshes = entry.meshes();
      if (this.meshesRemoved || meshes.some((m) => !entry.litSet.has(m))) this.resync(entry, meshes);
      entry.refreshIn -= 1;
      if (entry.refreshIn <= 0) this.rechoose(entry);
    }
  }

  private relink(entry: Tracked): void {
    this.unlink(entry);
    entry.room = this.roomAt(entry.position());
    this.setLit(entry, [...entry.lit.filter((m) => !m.isDisposed()), ...entry.meshes()]);
    entry.lights = this.choose(entry);
    entry.refreshIn = this.refreshFrames;
    RoomLighting.include(entry.lights, entry.lit);
  }

  /** Same room, new meshes (a new model part) or disposed ones: only the difference joins or leaves the lights. */
  private resync(entry: Tracked, meshes: readonly AbstractMesh[]): void {
    const gone = entry.lit.filter((m) => m.isDisposed());
    const added = meshes.filter((m) => !entry.litSet.has(m));
    if (gone.length > 0) RoomLighting.exclude(entry.lights, gone);
    if (added.length > 0) RoomLighting.include(entry.lights, added);
    this.setLit(entry, [...entry.lit.filter((m) => !m.isDisposed()), ...added]);
  }

  private setLit(entry: Tracked, meshes: AbstractMesh[]): void {
    for (const mesh of meshes) if (!entry.litSet.has(mesh)) LightExclusions.markDynamic(mesh);
    entry.litSet = new Set(meshes);
    entry.lit = [...entry.litSet];
  }

  /** The nearest lights again (it moved within a room with more lights than `count`): swaps only those that changed. */
  private rechoose(entry: Tracked): void {
    entry.refreshIn = this.refreshFrames;
    const next = this.choose(entry);
    const keep = new Set(next);
    const old = new Set(entry.lights);
    const leaving = entry.lights.filter((l) => !keep.has(l));
    if (leaving.length === 0) return;
    // Both happen before the next render, so no frame ever draws these meshes with another light count.
    RoomLighting.include(
      next.filter((l) => !old.has(l)),
      entry.lit,
    );
    RoomLighting.exclude(leaving, entry.lit);
    entry.lights = next;
  }

  /** `count` lights for a tracked thing: its room's nearest, then dark padding lights. */
  private choose(entry: Tracked): Light[] {
    const room = entry.room === null ? [] : this.lightsFor(entry.room);
    let chosen = room;
    if (room.length > this.lightCount) {
      const at = entry.position();
      chosen = room
        .map((light) => ({ light, d: Vector3.DistanceSquared(at, (light as PointLight).position ?? at) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.lightCount)
        .map((e) => e.light);
    }
    return [...chosen, ...this.padding.slice(0, this.lightCount - chosen.length)];
  }

  private unlink(entry: Tracked): void {
    RoomLighting.exclude(entry.lights, entry.lit);
    entry.room = null;
    entry.lights = [];
  }

  /*
   * Babylon hooks `push` and `splice` of `includedOnlyMeshes`: each call re-checks the light against every mesh of the
   * scene (`Light._resyncMeshes`, O(scene meshes)). A robot of ~50 parts entering a room with 6 lamps did that 300×,
   * a third of a combat frame (PERF.md „Souboj“). The array's own methods change the list without the hook and only
   * the meshes that changed re-check the light (`AbstractMesh._resyncLightSource`, what the hook would do for them).
   */
  /**
   * A disposed mesh leaves every light's list through `includedOnlyMeshes.splice`, which Babylon hooks to re-check the
   * light against the whole scene. Debris of one robot (~50 parts, each in 3+ lists) cost ~20 % of a throttled combat
   * frame that way. The light's list removes with the plain splice and re-checks only the meshes it removed.
   */
  private static cheapRemoval(light: Light): void {
    const list = light.includedOnlyMeshes;
    if (CHEAP_REMOVAL.has(list)) return;
    CHEAP_REMOVAL.add(list);
    list.splice = ((start: number, deleteCount?: number): AbstractMesh[] => {
      const removed = Array.prototype.splice.call(list, start, deleteCount ?? list.length - start) as AbstractMesh[];
      for (const mesh of removed) mesh._resyncLightSource(light);
      return removed;
    }) as typeof list.splice;
  }

  private static include(lights: readonly Light[], meshes: readonly AbstractMesh[]): void {
    for (const light of lights) {
      const list = light.includedOnlyMeshes;
      for (const mesh of meshes) {
        if (list.includes(mesh)) continue;
        Array.prototype.push.call(list, mesh);
        mesh._resyncLightSource(light);
      }
    }
  }

  private static exclude(lights: readonly Light[], meshes: readonly AbstractMesh[]): void {
    for (const light of lights) {
      const list = light.includedOnlyMeshes;
      for (const mesh of meshes) {
        const index = list.indexOf(mesh);
        if (index < 0) continue;
        Array.prototype.splice.call(list, index, 1);
        mesh._resyncLightSource(light);
      }
    }
  }
}
