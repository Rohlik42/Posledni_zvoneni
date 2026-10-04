import type { Scene } from "@babylonjs/core/scene";
import { Settings } from "../core/Settings";
import type { ITeacherModel } from "./ITeacherModel";
import { GltfTeacherModel } from "./models/GltfTeacherModel";
import { ProceduralTeacherModel } from "./models/ProceduralTeacherModel";
import { PeopleLibrary } from "./PeopleLibrary";
import { TeacherConfig, type TeacherData } from "./TeacherConfig";

/** `procedural` = the primitive caricature (default), `gltf` = the real glTF people (experimental, heavier). */
export type TeacherModelKind = "procedural" | "gltf";

/** URL override for tests and comparisons: `?people=gltf` / `?people=lowpoly` (wins over the setting). */
export const PEOPLE_PARAM = "people";
const PARAM_VALUES: Readonly<Record<string, TeacherModelKind>> = { gltf: "gltf", lowpoly: "procedural" };

/**
 * Picks the captive teachers' model (FEEDBACK 2026-10-04: the glTF people made the game lag near a teacher, so the
 * primitive teachers are the default again and the glTF ones sit behind the setting „Realistické postavy učitelů“,
 * `data/menu.json → settings.realisticPeople`, or `?people=gltf`). The choice is fixed when a level starts
 * (`preload`): only then are the glTF files loaded — in the default mode nothing glTF is fetched or parsed. A changed
 * setting applies to the next level (`stale` makes „Nová hra“ reload the page).
 */
export class TeacherModelFactory {
  /** Kind the current level was built with (null before any `preload`). */
  private static active: TeacherModelKind | null = null;

  /** The kind asked for now: the URL override, else the stored setting. */
  static requested(): TeacherModelKind {
    const param = new URLSearchParams(window.location.search).get(PEOPLE_PARAM);
    const forced = param === null ? undefined : PARAM_VALUES[param];
    if (forced !== undefined) return forced;
    return Settings.shared().values.realisticPeople ? "gltf" : "procedural";
  }

  /** The kind of the teachers built now: fixed by the last `preload`, else the requested one. */
  static get kind(): TeacherModelKind {
    return TeacherModelFactory.active ?? TeacherModelFactory.requested();
  }

  /** True when the setting changed since the level was built (the teachers on screen are the other kind). */
  static get stale(): boolean {
    const active = TeacherModelFactory.active;
    return active !== null && active !== TeacherModelFactory.requested();
  }

  /**
   * Fixes the kind for the level about to be built and loads what it needs: the glTF files of the given teachers
   * (default: all) for `gltf`, nothing for the primitive teachers. Await it before building teachers.
   */
  static async preload(scene: Scene, teacherIds?: readonly string[]): Promise<TeacherModelKind> {
    const kind = TeacherModelFactory.requested();
    TeacherModelFactory.active = kind;
    if (kind === "gltf") {
      const teachers = teacherIds === undefined ? TeacherConfig.load().teachers : teacherIds.map((id) => TeacherConfig.teacher(id));
      await PeopleLibrary.preload(scene, teachers.map((teacher) => teacher.gltfLook.person));
    }
    return kind;
  }

  /** The model of `teacher` in the current kind; node names start with `name`. */
  static create(scene: Scene, teacher: TeacherData, name: string, kind: TeacherModelKind = TeacherModelFactory.kind): ITeacherModel {
    if (kind === "gltf") {
      const { person, colors, scale } = teacher.gltfLook;
      return new GltfTeacherModel(scene, { name, person, colors, scale });
    }
    const { variant, colors, features } = teacher.look;
    return new ProceduralTeacherModel(scene, { name, variant, colors, features });
  }
}
