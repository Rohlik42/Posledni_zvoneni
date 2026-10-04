import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Physics } from "../core/Physics";
import { MatteDefaults } from "../rendering/MatteDefaults";
import { Palette } from "../utils/Palette";
import { Texts } from "../utils/Texts";
import type { ITeacherModel } from "./ITeacherModel";
import type { NametagData, TeacherData, TeachersData } from "./TeacherConfig";
import { TeacherModelFactory, type TeacherModelKind } from "./TeacherModelFactory";

/** `bound` = tied to the chair with the trap armed; `freed` = the quiz was answered, shackles off. */
export type TeacherState = "bound" | "freed";

/** Where a teacher sits: world position of the chair (floor), heading and the room it lights from. */
export interface TeacherPlacement {
  position: Vector3;
  /** Heading in radians (0 = the teacher faces +z). */
  yaw: number;
  /** Room id (level) or null (dev scenes). */
  room: string | null;
}

/** Name tag lines are centred: x = this share of the texture width. */
const HALF = 0.5;

/**
 * One captive teacher (DESIGN §3, §6): the model on its chair (`TeacherModelFactory`: the primitive caricature by
 * default, the glTF person behind the „realistic people“ setting, FEEDBACK 2026-10-04), a name tag above the head (LEGACY §1: surname + subject, always facing the camera, unlit) and a static collider so the player cannot
 * walk through the chair. `free()` drops the shackles; the teacher then gets up in the fixed step (`update`) and stays in the room.
 */
export class Teacher {
  readonly model: ITeacherModel;
  readonly nametag: Mesh;
  /** Model meshes and the name tag (room lighting attaches the model meshes). */
  readonly meshes: readonly AbstractMesh[];

  private stateValue: TeacherState = "bound";
  private freedSeconds = 0;
  private readonly collider: Mesh | null;
  private readonly nametagTexture: DynamicTexture;
  private readonly tagData: NametagData;

  constructor(
    private readonly scene: Scene,
    readonly data: TeacherData,
    readonly placement: TeacherPlacement,
    private readonly config: TeachersData,
    physics: Physics | null,
    kind: TeacherModelKind = TeacherModelFactory.kind,
  ) {
    this.model = TeacherModelFactory.create(scene, data, `teacher:${data.id}`, kind);
    this.model.root.position.copyFrom(placement.position);
    this.model.root.rotation.y = placement.yaw;
    this.tagData = config.nametag;
    this.nametagTexture = this.drawNametag(scene);
    this.nametag = this.createNametag(scene);
    this.collider = physics === null ? null : this.createCollider(scene, physics);
    this.meshes = [...this.model.meshes];
    this.placeNametag();
  }

  get id(): string {
    return this.data.id;
  }

  get state(): TeacherState {
    return this.stateValue;
  }

  get isBound(): boolean {
    return this.stateValue === "bound";
  }

  /** Surname, with the nickname when the teacher has one (the new physics teacher). */
  get displayName(): string {
    const { surname, nickname } = this.data;
    return nickname === undefined ? surname : Texts.format(Texts.load().teachers.nameWithNickname, { surname, nickname });
  }

  /** Middle of the chest in the world: what the player looks at to talk. */
  get chestPosition(): Vector3 {
    return this.model.chestPosition();
  }

  /** World position of the trap on the chest band (explosion origin). */
  get trapPosition(): Vector3 {
    return this.chestPosition;
  }

  /** Floor point in front of the chair where dropped rewards land. */
  get dropPosition(): Vector3 {
    const forward = this.model.standForward;
    const p = this.placement.position;
    return new Vector3(p.x + Math.sin(this.placement.yaw) * forward, p.y, p.z + Math.cos(this.placement.yaw) * forward);
  }

  /** 0 = seated, 1 = standing. */
  get standing(): number {
    return this.model.standing;
  }

  /** Shackles and trap off; the teacher stands up over the next fixed steps. */
  free(): void {
    if (this.stateValue === "freed") return;
    this.stateValue = "freed";
    this.freedSeconds = 0;
    this.model.setBound(false);
  }

  /**
   * Restores a checkpoint state at once (phase 16): `freed` = shackles off and standing, `bound` = seated in shackles
   * with the trap armed again (a teacher freed after the checkpoint).
   */
  restore(state: TeacherState): void {
    this.stateValue = state;
    this.freedSeconds = 0;
    this.model.setBound(state === "bound");
    this.model.setStanding(state === "freed" ? 1 : 0);
    this.placeNametag();
  }

  /** Fixed step: getting up after being freed (smoothstep over `standTime` after `standDelay`). */
  update(dt: number): void {
    if (this.stateValue !== "freed" || this.model.standing >= 1) return;
    this.freedSeconds += dt;
    const { standDelay, standTime } = this.config.model;
    const t = Math.min(1, Math.max(0, (this.freedSeconds - standDelay) / standTime));
    this.model.setStanding(t * t * (3 - 2 * t));
  }

  /**
   * Per rendered frame: idle motion (real time, so the trap keeps blinking while the quiz pauses the game); a bound
   * teacher now and then looks at the camera.
   */
  animate(time: number, alarm: boolean): void {
    this.model.animate(time, alarm, this.scene.activeCamera?.globalPosition ?? null);
    this.placeNametag();
  }

  dispose(): void {
    this.model.dispose();
    this.nametag.dispose();
    this.nametagTexture.dispose();
    this.collider?.dispose();
  }

  /** Keeps the name tag `aboveHead` metres over the top of the head (which rises when the teacher stands up). */
  private placeNametag(): void {
    const top = this.model.headTopPosition();
    this.nametag.position.set(top.x, top.y + this.tagData.aboveHead, top.z);
  }

  private drawNametag(scene: Scene): DynamicTexture {
    const tag = this.tagData;
    const texture = new DynamicTexture(
      `teacher:${this.data.id}:nametag`,
      { width: tag.textureWidth, height: tag.textureHeight },
      scene,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, tag.textureWidth, tag.textureHeight);
    ctx.fillStyle = Palette.hex(tag.background);
    ctx.fillRect(0, 0, tag.textureWidth, tag.textureHeight);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const centre = tag.textureWidth * HALF;
    ctx.font = tag.nameFont;
    ctx.fillStyle = Palette.hex(tag.nameColor);
    ctx.fillText(this.data.surname, centre, tag.nameY, tag.textureWidth);
    ctx.font = tag.subjectFont;
    ctx.fillStyle = Palette.hex(tag.subjectColor);
    ctx.fillText(this.data.subject, centre, tag.subjectY, tag.textureWidth);
    texture.hasAlpha = true;
    texture.update();
    return texture;
  }

  private createNametag(scene: Scene): Mesh {
    const plane = MeshBuilder.CreatePlane(`teacher:${this.data.id}:nametag`, { width: this.tagData.width, height: this.tagData.height }, scene);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    const material = MatteDefaults.material(`teacher:${this.data.id}:nametag`, scene);
    // Unlit (LEGACY §1 „nesvítí“): without lighting only the emissive term shows, so the texture is the emissive
    // colour; the diffuse slot carries the alpha of the semi-transparent background.
    material.diffuseTexture = this.nametagTexture;
    material.emissiveTexture = this.nametagTexture;
    material.useAlphaFromDiffuseTexture = true;
    material.diffuseColor = Color3.Black();
    material.emissiveColor = Color3.Black();
    material.disableLighting = true;
    material.backFaceCulling = false;
    plane.material = material;
    return plane;
  }

  /**
   * World-space bounds of the chair collider (null without physics): the level cuts them out of the navmesh, so robots
   * and navmesh paths go around a captive teacher instead of into the collider (FEEDBACK 2026-10-04).
   */
  colliderBounds(): { min: Vector3; max: Vector3 } | null {
    if (this.collider === null) return null;
    this.collider.computeWorldMatrix(true);
    const box = this.collider.getBoundingInfo().boundingBox;
    return { min: box.minimumWorld.clone(), max: box.maximumWorld.clone() };
  }

  /** Invisible static box over the chair (rotated with the teacher). */
  private createCollider(scene: Scene, physics: Physics): Mesh {
    const { size, center } = this.config.collider;
    const box = MeshBuilder.CreateBox(`teacher:${this.data.id}:collider`, { width: size[0], height: size[1], depth: size[2] }, scene);
    const sin = Math.sin(this.placement.yaw);
    const cos = Math.cos(this.placement.yaw);
    const p = this.placement.position;
    box.position.set(p.x + center[0] * cos + center[2] * sin, p.y + center[1], p.z - center[0] * sin + center[2] * cos);
    box.rotation.y = this.placement.yaw;
    box.isVisible = false;
    box.isPickable = false;
    physics.addStatic(box);
    return box;
  }
}
