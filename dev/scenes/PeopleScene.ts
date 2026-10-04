import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Game } from "../../src/core/Game";
import { TeacherModel } from "../../src/level/models/TeacherModel";
import { PeopleLibrary } from "../../src/level/PeopleLibrary";
import { TeacherConfig } from "../../src/level/TeacherConfig";
import { FlatMaterials } from "../../src/rendering/FlatMaterials";
import { PaletteColor } from "../../src/rendering/PaletteColor";
import { DevSceneData } from "../DevSceneData";
import { TestHooks } from "../../src/core/TestHooks";
import { PERSON_BONES } from "../../src/level/PeopleConfig";
import type { Vec3Like } from "../../src/player/Player";

const DEG_TO_RAD = Math.PI / 180;
const MS_PER_SECOND = 1000;
const HALF = 0.5;
/** The camera's near plane for close-ups (m). */
const NEAR = 0.05;

/** `window.__game.people` — joints (model space of each teacher) of the dev scene's figures. */
export interface PeopleTestApi {
  joints: (which: "seated" | "standing") => Record<string, Vec3Like>;
  headTop: (which: "seated" | "standing") => Vec3Like;
  animating: () => boolean;
}

declare module "../../src/core/TestHooks" {
  interface GameTestModules {
    people: PeopleTestApi;
  }
}

export const id = "people";
export const title =
  "glTF učitelé zblízka: vlevo svázaný na židli, vpravo osvobozený stojící (?seated=, ?standing= id z teachers.json; ?yaw=, ?pitch=, ?dist= kamera; ?stand=0…1 rozpracované vstávání; ?lamp=0 bez zářivky)";

export async function create(game: Game): Promise<void> {
  const { scene } = game;
  const data = DevSceneData.load().people;
  const params = new URLSearchParams(window.location.search);
  const number = (name: string, fallback: number): number => {
    const value = params.get(name);
    return value === null || Number.isNaN(Number(value)) ? fallback : Number(value);
  };
  const seatedId = params.get("seated") ?? data.seated;
  const standingId = params.get("standing") ?? data.standing;
  const seatedLook = TeacherConfig.teacher(seatedId).look;
  const standingLook = TeacherConfig.teacher(standingId).look;
  await PeopleLibrary.preload(scene, [seatedLook.person, standingLook.person]);

  game.addAmbientLight();
  const floor = MeshBuilder.CreateGround("people-floor", { width: data.floor.size, height: data.floor.size }, scene);
  floor.material = FlatMaterials.get(scene, data.floor.color);
  if (params.get("lamp") !== "0") {
    const lamp = new PointLight("people-lamp", Vector3.FromArray(data.lamp.position), scene);
    lamp.diffuse = PaletteColor.color3(data.lamp.color);
    lamp.specular = Color3.Black();
    lamp.intensity = data.lamp.intensity;
    lamp.range = data.lamp.range;
  }

  const seated = new TeacherModel(scene, { name: `teacher:${seatedId}`, ...seatedLook });
  seated.root.position.x = data.spacing * HALF;
  const standing = new TeacherModel(scene, { name: `teacher:${standingId}`, ...standingLook });
  standing.root.position.x = -data.spacing * HALF;
  standing.setBound(false);
  standing.setStanding(number("stand", 1));

  const { camera: view } = data;
  const yaw = number("yaw", view.yawDeg) * DEG_TO_RAD;
  const pitch = number("pitch", view.pitchDeg) * DEG_TO_RAD;
  const distance = number("dist", view.distance);
  const target = Vector3.FromArray(view.target);
  const offset = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).scale(distance);
  const camera = new UniversalCamera("people-camera", target.add(offset), scene);
  camera.setTarget(target);
  camera.fov = view.fov;
  camera.minZ = NEAR;
  camera.attachControl(game.canvas, true);
  game.useCamera(camera);

  const plain = (v: Vector3): Vec3Like => ({ x: v.x, y: v.y, z: v.z });
  TestHooks.register("people", {
    joints: (which) => {
      const model = which === "standing" ? standing : seated;
      return Object.fromEntries(PERSON_BONES.map((role) => [role, plain(model.person.jointPosition(role))]));
    },
    headTop: (which) => plain((which === "standing" ? standing : seated).headTopPosition()),
    animating: () => standing.person.animating,
  });

  let time = 0;
  scene.onBeforeRenderObservable.add(() => {
    time += game.engine.getDeltaTime() / MS_PER_SECOND;
    seated.animate(time, false, camera.globalPosition);
    standing.animate(time, false, camera.globalPosition);
  });
}
