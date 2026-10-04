import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable, type Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "../core/Game";
import type { Physics } from "../core/Physics";
import { TestHooks } from "../core/TestHooks";
import type { Player, Vec3Like } from "../player/Player";
import type { QuizSystem } from "../quiz/QuizSystem";
import { Texts, type TextsData } from "../utils/Texts";
import { LevelLayout } from "./LevelLayout";
import type { RoomLighting } from "./RoomLighting";
import { Teacher, type TeacherPlacement, type TeacherState } from "./Teacher";
import { TeacherConfig, type TeachersData } from "./TeacherConfig";
import { TeacherModelFactory, type TeacherModelKind } from "./TeacherModelFactory";

const DEG_TO_RAD = Math.PI / 180;
const MS_PER_SECOND = 1000;

/** A teacher of `data/teachers.json` and where to seat them. */
export interface TeacherSpec {
  id: string;
  placement: TeacherPlacement;
}

export interface TeacherInfo {
  id: string;
  surname: string;
  name: string;
  subject: string;
  room: string | null;
  state: TeacherState;
  /** 0 = seated, 1 = standing. */
  standing: number;
  /** Chair position (floor). */
  position: Vec3Like;
  /** Chest (what the player looks at); rises when the teacher stands. */
  chest: Vec3Like;
  /** Height of the top of the head above the floor (m). */
  headHeight: number;
  /** Shackles and trap shown. */
  shackled: boolean;
  trapLedOn: boolean;
  nametag: { visible: boolean; height: number };
}

/** `window.__game.teachers` — the captive teachers, the one in front of the player and its hint. */
export interface TeachersTestApi {
  list: () => TeacherInfo[];
  get: (id: string) => TeacherInfo | null;
  readonly target: string | null;
  readonly hint: string | null;
  /** Lines said by freed teachers (E), newest last. */
  messages: () => string[];
  /** Model of the teachers: `procedural` (default) or `gltf` (setting „Realistické postavy učitelů“ / `?people=gltf`). */
  readonly modelKind: TeacherModelKind;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    teachers: TeachersTestApi;
  }
}

/**
 * The captive teachers of a scene (phase 11): builds them, lets them get up in the fixed step and animates them per
 * frame, and handles E at the teacher in front of the player — a bound teacher opens the quiz (`QuizSystem`), a freed
 * one repeats their line. A targeted teacher takes E away from doors (`DoorSystem.yieldInteract`). The level gets its
 * teachers from `levelSpecs` (phase 16 seats them in the level).
 */
export class TeacherSystem {
  readonly teachers: Teacher[];
  /** Primitive (default) or glTF teachers (FEEDBACK 2026-10-04), fixed when the system is built. */
  readonly modelKind: TeacherModelKind;
  /** Lines of freed teachers for the HUD toasts. */
  readonly onMessage = new Observable<string>();

  private readonly data: TeachersData;
  private readonly texts: TextsData;
  private readonly cone: number;
  private readonly removeSystem: () => void;
  private readonly frameObserver: Observer<Scene>;
  private targetTeacher: Teacher | null = null;
  private timeSeconds = 0;
  private readonly log: string[] = [];

  private constructor(
    private readonly game: Game,
    physics: Physics | null,
    private readonly player: Player,
    private readonly quiz: QuizSystem,
    specs: readonly TeacherSpec[],
    lighting: RoomLighting | null,
  ) {
    this.data = TeacherConfig.load();
    this.texts = Texts.load();
    this.cone = Math.cos(this.data.interact.coneDeg * DEG_TO_RAD);
    this.modelKind = TeacherModelFactory.kind;
    this.teachers = specs.map((spec) => new Teacher(game.scene, TeacherConfig.teacher(spec.id), spec.placement, this.data, physics, this.modelKind));
    if (lighting !== null) {
      for (const teacher of this.teachers) if (teacher.placement.room !== null) lighting.attach(teacher.meshes, [teacher.placement.room]);
    }
    // Shaders (of the glTF people) compile in the background once their room lights are known (no stall on first sight).
    for (const teacher of this.teachers) void teacher.model.prepare();
    quiz.useTeachers((id) => this.get(id) ?? null);
    this.removeSystem = game.addSystem({ update: (dt) => this.update(dt) });
    this.frameObserver = game.scene.onBeforeRenderObservable.add(() => this.frame());
    this.registerTestHooks();
  }

  static create(
    game: Game,
    physics: Physics | null,
    player: Player,
    quiz: QuizSystem,
    specs: readonly TeacherSpec[],
    lighting: RoomLighting | null = null,
  ): TeacherSystem {
    return new TeacherSystem(game, physics, player, quiz, specs, lighting);
  }

  /** Teachers of `data/teachers.json` on their chairs from `data/level.json → teachers` (by slot), facing `lookAt`. */
  static levelSpecs(layout: LevelLayout): TeacherSpec[] {
    return TeacherConfig.load().teachers.map((teacher) => {
      const slot = layout.level.teachers.find((s) => s.slot === teacher.slot);
      if (slot === undefined) throw new Error(`${TeacherConfig.file}: teacher ${teacher.id} has slot ${teacher.slot}, which data/level.json does not seat`);
      const y = layout.floorY(layout.room(slot.room));
      const chair = LevelLayout.toWorld(slot.chair.x, y, slot.chair.z);
      const look = LevelLayout.toWorld(slot.lookAt.x, y, slot.lookAt.z);
      return {
        id: teacher.id,
        placement: { position: new Vector3(chair.x, chair.y, chair.z), yaw: Math.atan2(look.x - chair.x, look.z - chair.z), room: slot.room },
      };
    });
  }

  get(id: string): Teacher | undefined {
    return this.teachers.find((teacher) => teacher.id === id);
  }

  /** The teacher E would talk to now, or null. */
  get target(): Teacher | null {
    return this.targetTeacher;
  }

  /** True while E belongs to a teacher (doors yield it). */
  get takesInteract(): boolean {
    return this.targetTeacher !== null;
  }

  /** „E — osvobodit: Šiklová (Matematika)“ / „E — promluvit: …“ for the targeted teacher, or null. */
  get hint(): string | null {
    const teacher = this.targetTeacher;
    if (teacher === null || this.quiz.active) return null;
    const t = this.texts.teachers;
    const values = { controls: t.controls, name: teacher.displayName, subject: teacher.data.subject };
    return Texts.format(teacher.isBound ? t.hintFree : t.hintTalk, values);
  }

  /** Ids of the freed teachers (checkpoints, phase 16). */
  freedIds(): string[] {
    return this.teachers.filter((t) => !t.isBound).map((t) => t.id);
  }

  /** Frees exactly the teachers in `freed` (standing) and ties the others back to their chairs. */
  restore(freed: readonly string[]): void {
    for (const teacher of this.teachers) teacher.restore(freed.includes(teacher.id) ? "freed" : "bound");
  }

  dispose(): void {
    this.removeSystem();
    this.game.scene.onBeforeRenderObservable.remove(this.frameObserver);
    for (const teacher of this.teachers) teacher.dispose();
    this.onMessage.clear();
  }

  private update(dt: number): void {
    for (const teacher of this.teachers) teacher.update(dt);
    this.targetTeacher = this.player.health.isDead || this.quiz.active ? null : this.findTarget();
    const teacher = this.targetTeacher;
    if (teacher === null || !this.game.input.wasPressed("interact")) return;
    if (teacher.isBound) this.quiz.open(teacher);
    else this.say(teacher.data.freedLine);
  }

  /** Idle motion on real time (breathing and the blinking trap go on while the quiz pauses the game). */
  private frame(): void {
    this.timeSeconds += this.game.engine.getDeltaTime() / MS_PER_SECOND;
    const asked = this.quiz.current;
    for (const teacher of this.teachers) teacher.animate(this.timeSeconds, teacher === asked);
  }

  /** Closest teacher within reach whose chest the player looks at (or who sits right next to the player). */
  private findTarget(): Teacher | null {
    const eye = this.player.eyePosition;
    const { yaw, pitch } = this.player.camera;
    const forward = new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const { range, nearRange } = this.data.interact;
    let best: Teacher | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const teacher of this.teachers) {
      const to = teacher.chestPosition.subtract(eye);
      const distance = to.length();
      if (distance > range || distance >= bestDistance) continue;
      const facing = distance > 0 ? Vector3.Dot(to.scale(1 / distance), forward) : 1;
      if (facing < this.cone && distance > nearRange) continue;
      best = teacher;
      bestDistance = distance;
    }
    return best;
  }

  private say(line: string): void {
    this.log.push(line);
    this.onMessage.notifyObservers(line);
  }

  private info(teacher: Teacher): TeacherInfo {
    const plain = (v: Vector3): Vec3Like => ({ x: v.x, y: v.y, z: v.z });
    return {
      id: teacher.id,
      surname: teacher.data.surname,
      name: teacher.displayName,
      subject: teacher.data.subject,
      room: teacher.placement.room,
      state: teacher.state,
      standing: teacher.standing,
      position: plain(teacher.placement.position),
      chest: plain(teacher.chestPosition),
      headHeight: teacher.model.headTopPosition().y - teacher.placement.position.y,
      shackled: teacher.model.isBound,
      trapLedOn: teacher.model.trapLedOn,
      nametag: { visible: teacher.nametag.isEnabled() && teacher.nametag.isVisible, height: teacher.nametag.position.y - teacher.placement.position.y },
    };
  }

  private registerTestHooks(): void {
    const system = this;
    TestHooks.register("teachers", {
      list: () => system.teachers.map((t) => system.info(t)),
      get: (id) => {
        const teacher = system.get(id);
        return teacher === undefined ? null : system.info(teacher);
      },
      get target() {
        return system.targetTeacher?.id ?? null;
      },
      get hint() {
        return system.hint;
      },
      messages: () => [...system.log],
      modelKind: system.modelKind,
    });
  }
}
