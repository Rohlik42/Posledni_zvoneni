import type { Light } from "@babylonjs/core/Lights/light";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "../core/Game";
import type { Level } from "./Level";

interface Tracked {
  meshes: () => readonly AbstractMesh[];
  position: () => Vector3;
  room: string | null;
  lit: AbstractMesh[];
}

/**
 * Level point lights shine only on the meshes of their own room (`includedOnlyMeshes`, phase 9: no shadows, so a light
 * would otherwise reach through walls). Everything added to the level later must join those lists too, or it stays
 * unlit: door leaves and pickups are attached to their room once, moving things (robots, the weapon in hand) are
 * tracked and switch lights when they enter another room (checked every frame, re-linked only on a room change).
 * Extra lights (a key's glow) shine on their room's static meshes and on whatever is attached to or tracked in it.
 */
export class RoomLighting {
  private readonly tracked = new Set<Tracked>();
  /** Meshes attached per room (static door leaves, pickups), so extra lights can include them. */
  private readonly attached = new Map<string, Set<AbstractMesh>>();
  private readonly extraLights = new Map<string, Light[]>();
  private readonly frameObserver: Observer<Scene>;

  constructor(
    private readonly game: Game,
    private readonly level: Level,
  ) {
    this.frameObserver = game.scene.onBeforeRenderObservable.add(() => this.update());
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
    const entry: Tracked = { meshes, position, room: null, lit: [] };
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
    for (const entry of this.tracked) if (entry.room === roomId) RoomLighting.include([light], entry.lit);
  }

  removeLight(light: Light): void {
    for (const [room, list] of this.extraLights) this.extraLights.set(room, list.filter((l) => l !== light));
  }

  /** Room of a tracked thing right now (tests). */
  trackedRooms(): (string | null)[] {
    return [...this.tracked].map((t) => t.room);
  }

  dispose(): void {
    this.game.scene.onBeforeRenderObservable.remove(this.frameObserver);
    for (const entry of this.tracked) this.unlink(entry);
    this.tracked.clear();
  }

  private update(): void {
    for (const entry of this.tracked) {
      const room = this.roomAt(entry.position());
      const meshes = entry.meshes();
      if (room !== entry.room || meshes.length !== entry.lit.length || meshes.some((m, i) => m !== entry.lit[i])) this.relink(entry);
    }
  }

  private relink(entry: Tracked): void {
    this.unlink(entry);
    entry.room = this.roomAt(entry.position());
    entry.lit = [...entry.meshes()];
    if (entry.room !== null) RoomLighting.include(this.lightsFor(entry.room), entry.lit);
  }

  private unlink(entry: Tracked): void {
    if (entry.room !== null) RoomLighting.exclude(this.lightsFor(entry.room), entry.lit);
    entry.room = null;
    entry.lit = [];
  }

  private static include(lights: readonly Light[], meshes: readonly AbstractMesh[]): void {
    for (const light of lights) {
      const list = light.includedOnlyMeshes;
      for (const mesh of meshes) if (!list.includes(mesh)) list.push(mesh);
    }
  }

  private static exclude(lights: readonly Light[], meshes: readonly AbstractMesh[]): void {
    for (const light of lights) {
      const list = light.includedOnlyMeshes;
      for (const mesh of meshes) {
        const index = list.indexOf(mesh);
        if (index >= 0) list.splice(index, 1);
      }
    }
  }
}
