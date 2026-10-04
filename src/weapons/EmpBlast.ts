import { Constants } from "@babylonjs/core/Engines/constants";
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { FrameTags } from "../rendering/FrameTags";
import { PaletteColor } from "../rendering/PaletteColor";
import { ShaderPrewarm } from "../rendering/ShaderPrewarm";
import { Random } from "../utils/Random";
import { ElectricArc } from "./ElectricArc";
import type { HitResult } from "./Hitscan";
import type { EffectData } from "./WeaponConfig";

/** Blasts drawn at once; a third one takes over the oldest shell (no mesh is built in play). */
const POOL_SIZE = 2;
const SHELL_SEGMENTS = 16;
const FLASH_SEGMENTS = 10;
/** Brightness of the shell's rim and of its middle (× the effect glow); the rim reads as an expanding bubble. */
const SHELL_RIM = 1.4;
const SHELL_FACE = 0.18;
const SHELL_FRESNEL_POWER = 2.5;
/** Peak alpha of the shell and of the flash ball. */
const SHELL_ALPHA = 0.85;
const FLASH_ALPHA = 0.95;
/** The flash ball at the impact grows to this radius (m). */
const FLASH_RADIUS = 1.6;
/** The shell eases out: radius = start + (end − start) × (1 − (1 − t)^EASE). */
const SHELL_EASE = 3;
/** Arcs into the empty air around the blast (they crackle even when no robot is near), reaching this share of the radius. */
const AMBIENT_ARCS = 6;
const AMBIENT_REACH: [number, number] = [0.25, 0.55];
/** Arcs start this far above the impact point (m), so they leave from the ball's centre, not the floor. */
const ARC_LIFT = 0.25;
/** `FrameTags` of a blast that took over a shell still expanding. */
const TAG_POOL = "pool";

export interface EmpBlastOptions {
  /** Colours of the shell, flash and arcs (`color`, `colorEnd`), their glow, arc strokes, sparks. */
  effect: EffectData;
  /** Shell radius at the start (m); it grows to the EMP radius over `shellTime` s. */
  shellStart: number;
  shellTime: number;
  /** How long the flash ball at the impact lasts (s). */
  flashTime: number;
  seed: number;
}

interface Shell {
  shell: Mesh;
  shellMaterial: StandardMaterial;
  flash: Mesh;
  flashMaterial: StandardMaterial;
  age: number;
  radius: number;
  active: boolean;
}

/**
 * The BFG 9000's EMP pulse (FEEDBACK 2026-10-04): where the plasma ball bursts, a translucent electric shell (an unlit
 * additive sphere with a bright Fresnel rim) grows from `shellStart` to the EMP radius and fades, a bright flash ball
 * swells and vanishes at the impact, and branching lightning arcs (`ElectricArc`) jump from the impact to every robot
 * the pulse struck, with a few more crackling into the empty air. Everything is pooled and drawn in the load-time
 * warm-up (`ShaderPrewarm`), so the first blast builds no shader or pipeline.
 */
export class EmpBlast {
  private readonly shells: Shell[] = [];
  private readonly arcs: ElectricArc;
  private readonly random: Random;
  private fired = 0;

  constructor(
    scene: Scene,
    name: string,
    private readonly options: EmpBlastOptions,
  ) {
    const { effect } = options;
    this.random = new Random(options.seed);
    for (let i = 0; i < POOL_SIZE; i++) this.shells.push(this.createShell(scene, `${name}-emp-${i}`));
    this.arcs = new ElectricArc(scene, `${name}-emp`, effect, options.seed + 1);
  }

  /** Blasts fired so far, whether a shell is showing, and live arc particles (tests). */
  get count(): number {
    return this.fired;
  }

  get visible(): boolean {
    return this.shells.some((s) => s.active);
  }

  get arcParticles(): number {
    return this.arcs.activeParticles;
  }

  /** Starts a blast at `center` growing to `radius`, with an arc to each of `targets`. */
  fire(center: Vector3, radius: number, targets: readonly HitResult[]): void {
    let shell = this.shells.find((s) => !s.active);
    if (shell === undefined) {
      FrameTags.note(TAG_POOL);
      shell = this.shells.reduce((oldest, s) => (s.age > oldest.age ? s : oldest));
    }
    shell.age = 0;
    shell.radius = radius;
    shell.active = true;
    shell.shell.position.copyFrom(center);
    shell.flash.position.copyFrom(center);
    shell.shell.setEnabled(true);
    shell.flash.setEnabled(true);
    this.pose(shell);
    this.fired++;

    const from = center.add(new Vector3(0, ARC_LIFT, 0));
    for (const target of targets) this.arcs.zap(from, target.point, { normal: target.normal });
    const { random } = this;
    for (let i = 0; i < AMBIENT_ARCS; i++) {
      const direction = new Vector3(random.range(-1, 1), random.range(-0.3, 1), random.range(-1, 1)).normalize();
      this.arcs.zap(from, from.add(direction.scaleInPlace(radius * random.range(AMBIENT_REACH[0], AMBIENT_REACH[1]))), null);
    }
  }

  /** Grows and fades the shells in the fixed step. */
  update(dt: number): void {
    for (const shell of this.shells) {
      if (!shell.active) continue;
      shell.age += dt;
      if (shell.age >= this.options.shellTime) {
        shell.active = false;
        shell.shell.setEnabled(false);
        shell.flash.setEnabled(false);
        continue;
      }
      this.pose(shell);
    }
  }

  dispose(): void {
    for (const s of this.shells) {
      s.shell.dispose();
      s.flash.dispose();
      s.shellMaterial.dispose();
      s.flashMaterial.dispose();
    }
    this.shells.length = 0;
    this.arcs.dispose();
  }

  private pose(shell: Shell): void {
    const { shellStart, shellTime, flashTime } = this.options;
    const t = Math.min(1, shell.age / shellTime);
    const grown = 1 - Math.pow(1 - t, SHELL_EASE);
    const radius = shellStart + (shell.radius - shellStart) * grown;
    shell.shell.scaling.setAll(radius * 2);
    shell.shellMaterial.alpha = SHELL_ALPHA * (1 - t);
    const f = Math.min(1, shell.age / flashTime);
    shell.flash.setEnabled(f < 1);
    shell.flash.scaling.setAll(FLASH_RADIUS * 2 * Math.sqrt(f + Number.EPSILON));
    shell.flashMaterial.alpha = FLASH_ALPHA * (1 - f);
  }

  private createShell(scene: Scene, name: string): Shell {
    const { effect } = this.options;
    const shellMaterial = EmpBlast.material(scene, `${name}-shell`, PaletteColor.emissive(effect.colorEnd, effect.glow * SHELL_FACE));
    const fresnel = new FresnelParameters();
    fresnel.leftColor = PaletteColor.emissive(effect.color, effect.glow * SHELL_RIM);
    fresnel.rightColor = PaletteColor.emissive(effect.colorEnd, effect.glow * SHELL_FACE);
    fresnel.power = SHELL_FRESNEL_POWER;
    fresnel.bias = 0;
    shellMaterial.emissiveFresnelParameters = fresnel;
    const flashMaterial = EmpBlast.material(scene, `${name}-flash`, PaletteColor.emissive(effect.color, effect.glow));
    const shell = EmpBlast.sphere(scene, `${name}-shell`, SHELL_SEGMENTS, shellMaterial);
    const flash = EmpBlast.sphere(scene, `${name}-flash`, FLASH_SEGMENTS, flashMaterial);
    return { shell, shellMaterial, flash, flashMaterial, age: 0, radius: 0, active: false };
  }

  private static sphere(scene: Scene, name: string, segments: number, material: StandardMaterial): Mesh {
    const mesh = MeshBuilder.CreateSphere(name, { diameter: 1, segments }, scene);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.applyFog = false;
    mesh.setEnabled(false);
    // Drawn once in the load-time warm-up: no pipeline is built at the first blast.
    ShaderPrewarm.for(scene).addMesh(mesh);
    return mesh;
  }

  private static material(scene: Scene, name: string, emissive: Color3): StandardMaterial {
    const material = new StandardMaterial(name, scene);
    material.disableLighting = true;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = emissive;
    material.alphaMode = Constants.ALPHA_ADD;
    material.alpha = SHELL_ALPHA;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    return material;
  }
}
