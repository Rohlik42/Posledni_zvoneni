import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Rendering/outlineRenderer";
import type { Scene } from "@babylonjs/core/scene";
import { DamageTargets } from "../core/DamageTargets";
import type { DamageType } from "../core/DamageTypes";
import type { IDamageable } from "../core/IDamageable";
import type { Simulated } from "../core/SceneSetup";
import { PaletteColor } from "../rendering/PaletteColor";
import { TargetModel } from "./models/TargetModel";
import type { TargetPlacement, TargetsData } from "./TargetConfig";

const DEG_TO_RAD = Math.PI / 180;
const BOARD_PART = "board";

/**
 * A practice target (IDamageable) for testing weapons: takes damage scaled by `resistances`, flashes when hit, tips
 * back when its health reaches zero and stands up again with full health after `resetDelay`. Runs in the fixed step.
 */
export class Target implements IDamageable, Simulated {
  readonly name: string;
  readonly model: TargetModel;
  private current: number;
  private flashLeft = 0;
  private downFor = 0;
  private fall = 0;
  private hits = 0;

  constructor(
    scene: Scene,
    placement: TargetPlacement,
    private readonly data: TargetsData,
  ) {
    this.name = placement.name;
    this.current = data.health;
    this.model = new TargetModel(scene, { name: placement.name });
    this.model.root.position = Vector3.FromArray(placement.position);
    this.model.root.rotation.y = placement.yaw;
    DamageTargets.attach(this.model.root, this);
    const overlay = PaletteColor.color3(data.flashColor);
    for (const mesh of this.model.meshes) {
      mesh.overlayColor = overlay;
      mesh.overlayAlpha = data.flashIntensity;
    }
  }

  get health(): number {
    return this.current;
  }

  get maxHealth(): number {
    return this.data.health;
  }

  get alive(): boolean {
    return this.current > 0;
  }

  get hitCount(): number {
    return this.hits;
  }

  /** World position of the board centre (where to aim). */
  get center(): Vector3 {
    this.model.root.computeWorldMatrix(true);
    this.model.board.computeWorldMatrix(true);
    const board = this.model.meshes.find((m) => m.name.endsWith(`-${BOARD_PART}`));
    return (board ?? this.model.board).getAbsolutePosition().clone();
  }

  takeDamage(amount: number, type: DamageType): number {
    if (!this.alive || !(amount > 0)) return 0;
    const taken = Math.min(this.current, amount * this.data.resistances[type]);
    this.current -= taken;
    this.hits++;
    this.flashLeft = this.data.flashTime;
    if (!this.alive) this.downFor = 0;
    return taken;
  }

  /** Full health, standing. */
  reset(): void {
    this.current = this.data.health;
    this.fall = 0;
    this.downFor = 0;
    this.flashLeft = 0;
    this.hits = 0;
    this.applyPose();
  }

  update(dt: number): void {
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    if (this.alive) {
      this.fall = Math.max(0, this.fall - dt / this.data.fallTime);
    } else {
      this.fall = Math.min(1, this.fall + dt / this.data.fallTime);
      this.downFor += dt;
      if (this.downFor >= this.data.resetDelay) this.current = this.data.health;
    }
    this.applyPose();
  }

  dispose(): void {
    this.model.dispose();
  }

  private applyPose(): void {
    this.model.board.rotation.x = this.fall * this.data.fallAngleDeg * DEG_TO_RAD;
    const flashing = this.flashLeft > 0;
    for (const mesh of this.model.meshes) mesh.renderOverlay = flashing;
  }
}
