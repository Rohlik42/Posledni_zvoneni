import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { PaletteColor } from "../rendering/PaletteColor";
import type { KeyColor } from "./LevelTypes";
import { Pickup, type PickupOptions } from "./Pickup";
import type { ItemData, PickupsData } from "./PickupConfig";

/** Palette group of the key colours (`keys.red`…). */
const KEY_PALETTE_GROUP = "keys";

/**
 * A key lying in the world (DESIGN §3, Doom style): the spinning `KeyModel` in the colour of its lock plus a point
 * light of the same colour (`data/pickups.json → keyLight`), so a key is visible from across a dark room.
 */
export class KeyPickup extends Pickup {
  readonly light: PointLight;

  constructor(scene: Scene, data: ItemData, config: PickupsData, options: PickupOptions) {
    super(scene, data, config, options);
    const color: KeyColor = data.key!;
    const { intensity, range, height } = config.keyLight;
    this.light = new PointLight(`pickup:${options.id}:light`, new Vector3(0, height, 0), scene);
    this.light.parent = this.root;
    this.light.diffuse = PaletteColor.color3(`${KEY_PALETTE_GROUP}.${color}`);
    this.light.specular = Color3.Black();
    this.light.intensity = intensity;
    this.light.range = range;
  }

  get color(): KeyColor {
    return this.data.key!;
  }

  override dispose(): void {
    this.light.dispose();
    super.dispose();
  }
}
