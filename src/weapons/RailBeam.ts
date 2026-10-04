import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { DropletEmitter } from "../rendering/DropletEmitter";
import { PaletteColor } from "../rendering/PaletteColor";
import { ShaderPrewarm } from "../rendering/ShaderPrewarm";
import { Random } from "../utils/Random";
import type { EffectData } from "./WeaponConfig";

const BEAM_TESSELLATION = 6;
const SPARK_CAPACITY = 300;
const DEFAULT_TIME = 0.4;
const DEFAULT_WIDTH = 0.04;
const DEFAULT_GLOW_WIDTH = 3;
/** The outer glow is this share as bright as the core. */
const GLOW_SHARE = 0.35;
/** The beam stays at full brightness for this share of its time, then fades. */
const HOLD_SHARE = 0.25;
const UP = Vector3.Up();
/** Sparks at a pierced robot: this share of `particles`, flying up to this many times faster than along the beam. */
const IMPACT_SHARE = 0.5;
const IMPACT_SPEED_SCALE = 3;

/**
 * The railgun's beam (phase 13): a bright core cylinder and a wider, fainter glow cylinder from the muzzle to where the
 * shot ended, both unlit and additive in HDR colour (they bloom), ignoring fog so the whole line reads; plus sparks
 * drifting off the beam and bursting at every pierced robot. It fades out over `effect.time` of simulated time.
 */
export class RailBeam {
  private readonly core: Mesh;
  private readonly glow: Mesh;
  private readonly coreMaterial: StandardMaterial;
  private readonly glowMaterial: StandardMaterial;
  private readonly sparks: DropletEmitter;
  private readonly random: Random;
  private readonly time: number;
  private readonly width: number;
  private readonly glowWidth: number;
  private remaining = 0;
  private fired = 0;

  constructor(
    scene: Scene,
    name: string,
    private readonly effect: EffectData,
    seed: number,
  ) {
    this.random = new Random(seed);
    this.time = effect.time ?? DEFAULT_TIME;
    this.width = effect.width ?? DEFAULT_WIDTH;
    this.glowWidth = this.width * (effect.glowWidth ?? DEFAULT_GLOW_WIDTH);
    this.coreMaterial = RailBeam.material(scene, `${name}-beam-core`, PaletteColor.emissive(effect.color, effect.glow));
    this.glowMaterial = RailBeam.material(scene, `${name}-beam-glow`, PaletteColor.emissive(effect.colorEnd, effect.glow * GLOW_SHARE));
    this.core = RailBeam.cylinder(scene, `${name}-beam-core`, this.coreMaterial);
    this.glow = RailBeam.cylinder(scene, `${name}-beam-glow`, this.glowMaterial);
    const color = PaletteColor.color4(effect.color);
    this.sparks = new DropletEmitter(`${name}-beam-sparks`, scene, {
      capacity: SPARK_CAPACITY,
      color: new Color4(color.r * effect.glow, color.g * effect.glow, color.b * effect.glow, 1),
      colorEnd: PaletteColor.color4(effect.colorEnd, 0),
      size: effect.size,
      gravity: effect.gravity,
      stretched: false,
    });
  }

  /** Whether the beam is lit right now, and how many beams were fired (tests). */
  get visible(): boolean {
    return this.remaining > 0;
  }

  get count(): number {
    return this.fired;
  }

  /** Lights the beam from `from` to `to`; `impacts` get a burst of sparks each (their normals face the shooter). */
  fire(from: Vector3, to: Vector3, impacts: readonly { point: Vector3; normal: Vector3 }[]): void {
    const path = to.subtract(from);
    const length = path.length();
    if (length <= 0) return;
    const direction = path.scale(1 / length);
    const middle = from.add(to).scaleInPlace(1 / 2);
    const rotation = Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(UP, direction, rotation);
    for (const [mesh, width] of [
      [this.core, this.width],
      [this.glow, this.glowWidth],
    ] as const) {
      mesh.position.copyFrom(middle);
      mesh.rotationQuaternion = rotation.clone();
      mesh.scaling.set(width, length, width);
      mesh.setEnabled(true);
    }
    this.remaining = this.time;
    this.fired++;
    this.setBrightness(1);

    const { effect, random } = this;
    for (let i = 0; i < effect.particles; i++) {
      const along = from.add(path.scale(random.next()));
      const drift = new Vector3(random.range(-1, 1), random.range(-1, 1), random.range(-1, 1)).normalize();
      this.sparks.emit({ position: along, velocity: drift.scaleInPlace(random.range(effect.speed[0], effect.speed[1])), life: random.range(effect.life[0], effect.life[1]) });
    }
    for (const impact of impacts) {
      for (let i = 0; i < effect.particles * IMPACT_SHARE; i++) {
        const direction = impact.normal.add(new Vector3(random.range(-1, 1), random.range(-1, 1), random.range(-1, 1))).normalize();
        this.sparks.emit({ position: impact.point.clone(), velocity: direction.scaleInPlace(random.range(effect.speed[1], effect.speed[1] * IMPACT_SPEED_SCALE)), life: random.range(effect.life[0], effect.life[1]) });
      }
    }
  }

  /** Fades the beam in the fixed step. */
  update(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining = Math.max(0, this.remaining - dt);
    const fadeTime = this.time * (1 - HOLD_SHARE);
    this.setBrightness(Math.min(1, this.remaining / fadeTime));
    if (this.remaining === 0) {
      this.core.setEnabled(false);
      this.glow.setEnabled(false);
    }
  }

  dispose(): void {
    this.core.dispose();
    this.glow.dispose();
    this.coreMaterial.dispose();
    this.glowMaterial.dispose();
    this.sparks.dispose();
  }

  private setBrightness(level: number): void {
    this.coreMaterial.alpha = level;
    this.glowMaterial.alpha = level * GLOW_SHARE;
  }

  private static material(scene: Scene, name: string, emissive: Color3): StandardMaterial {
    const material = new StandardMaterial(name, scene);
    material.disableLighting = true;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = emissive;
    material.alphaMode = Constants.ALPHA_ADD;
    material.alpha = 0;
    material.backFaceCulling = false;
    return material;
  }

  private static cylinder(scene: Scene, name: string, material: StandardMaterial): Mesh {
    const mesh = MeshBuilder.CreateCylinder(name, { diameter: 1, height: 1, tessellation: BEAM_TESSELLATION }, scene);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.applyFog = false;
    mesh.setEnabled(false);
    // Drawn once in the load-time warm-up (FEEDBACK 2026-10-04): no pipeline is built at the first shot.
    ShaderPrewarm.for(scene).addMesh(mesh);
    return mesh;
  }
}
