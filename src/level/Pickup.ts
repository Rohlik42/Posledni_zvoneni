import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { ModelRegistry, type ModelInstance } from "../utils/ModelRegistry";
import type { ItemData, PickupsData } from "./PickupConfig";
// Pickup models register themselves in ModelRegistry when their modules load.
import "../weapons/models/ExtinguisherModel";
import "./models/BalloonPackModel";
import "./models/CanisterModel";
import "./models/CapacitorModel";
import "./models/EnergyDrinkModel";
import "./models/KeyModel";
import "./models/MedkitModel";
import "./models/RubberBootsModel";

export interface PickupOptions {
  id: string;
  /** Item id of data/pickups.json. */
  item: string;
  /** Floor point under the pickup (world, m). */
  position: Vector3;
  /** Overrides the item's amount (robot drops carry their own). */
  amount?: number;
  /** Dropped by a robot (not placed by the level). */
  fromDrop?: boolean;
  /** Phase of the bobbing, so neighbouring pickups do not move in step. */
  phase?: number;
}

/**
 * A collectable lying in the world (DESIGN §6): the item's primitive model hovering above the floor, spinning and
 * bobbing, until the player walks into it (`PickupField` checks the distance and asks the inventory). Its meshes are
 * not pickable, so shots and robot sight pass through it.
 */
export class Pickup {
  readonly id: string;
  readonly item: string;
  readonly amount: number | undefined;
  readonly fromDrop: boolean;
  /** Floor point under the pickup. */
  readonly position: Vector3;
  readonly root: TransformNode;
  private readonly model: ModelInstance;
  private readonly phase: number;
  private collectedFlag = false;

  constructor(
    protected readonly scene: Scene,
    readonly data: ItemData,
    protected readonly config: PickupsData,
    options: PickupOptions,
  ) {
    this.id = options.id;
    this.item = options.item;
    this.amount = options.amount;
    this.fromDrop = options.fromDrop === true;
    this.position = options.position.clone();
    this.phase = options.phase ?? 0;
    const entry = data.model === undefined ? undefined : ModelRegistry.get(data.model);
    if (entry === undefined) throw new Error(`Pickup: item "${options.item}" has no model (data/pickups.json → items.${options.item}.model)`);
    this.root = new TransformNode(`pickup:${options.id}`, scene);
    this.root.position.copyFrom(this.position);
    this.model = entry.create(scene, { variant: data.variant, scale: data.scale, name: `pickup:${options.id}:${options.item}` });
    this.model.root.parent = this.root;
    for (const mesh of this.meshes) mesh.isPickable = false;
    this.animate(0);
  }

  get collected(): boolean {
    return this.collectedFlag;
  }

  get meshes(): AbstractMesh[] {
    return this.model.root.getChildMeshes(false);
  }

  /** Whether feet at `feet` touch the pickup (horizontal radius and height band from data). */
  touches(feet: Vector3): boolean {
    const { collectRadius, collectHeight } = this.config.pickup;
    const dx = feet.x - this.position.x;
    const dz = feet.z - this.position.z;
    return dx * dx + dz * dz <= collectRadius * collectRadius && Math.abs(feet.y - this.position.y) <= collectHeight;
  }

  /** Spin and bob at simulated time `time` (s). */
  animate(time: number): void {
    const { hover, bobAmplitude, bobSpeed, spinSpeed } = this.config.pickup;
    this.model.root.position.set(0, hover + (this.data.lift ?? 0) + Math.sin(time * bobSpeed + this.phase) * bobAmplitude, 0);
    this.model.root.rotation.y = time * spinSpeed + this.phase;
  }

  /** Removes the pickup from the world. */
  collect(): void {
    if (this.collectedFlag) return;
    this.collectedFlag = true;
    this.dispose();
  }

  dispose(): void {
    this.model.dispose();
    this.root.dispose(false, false);
  }
}
