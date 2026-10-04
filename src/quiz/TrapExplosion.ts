import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { SynthSounds } from "../audio/SynthSounds";
import type { TrapData } from "../level/TeacherConfig";
import type { Player } from "../player/Player";
import { DropletEmitter } from "../rendering/DropletEmitter";
import { PaletteColor } from "../rendering/PaletteColor";
import { Random } from "../utils/Random";

/** Sparks cool towards dark orange (share of green kept at the end of their life). */
const SPARK_END_GREEN = 0.35;
const FLASH_CAPACITY = 4;
/** Sparks leave the trap upwards and outwards more than downwards. */
const UPWARD_BIAS = 0.6;
/** Camera shake channel of the trap (runs beside hit and robot-death shakes). */
const SHAKE_CHANNEL = "trap";
const FULL_STRENGTH = 1;

/**
 * The robot trap going off after a wrong answer (DESIGN §3): a burst of sparks and a red flash at the trap, the
 * `trapBlast` sound and a camera shake. Particles animate on rendered frames, so the burst plays although the quiz
 * keeps the game paused. Damage is dealt by `QuizSystem`; numbers are in `data/teachers.json → trap`.
 */
export class TrapExplosion {
  private readonly sparks: DropletEmitter;
  private readonly flash: DropletEmitter;
  private readonly random: Random;
  private blasts = 0;

  constructor(
    scene: Scene,
    private readonly player: Player,
    private readonly sounds: SynthSounds,
    private readonly data: TrapData,
    seed: number,
  ) {
    this.random = new Random(seed);
    const spark = PaletteColor.color4(data.sparkColor);
    this.sparks = new DropletEmitter("trap-sparks", scene, {
      capacity: Math.max(1, data.sparks),
      color: new Color4(spark.r * data.sparkGlow, spark.g * data.sparkGlow, spark.b * data.sparkGlow, 1),
      colorEnd: new Color4(spark.r, spark.g * SPARK_END_GREEN, 0, 0),
      size: data.sparkSize,
      gravity: data.gravity,
      stretched: false,
    });
    const flash = PaletteColor.color4(data.flashColor);
    this.flash = new DropletEmitter("trap-flash", scene, {
      capacity: FLASH_CAPACITY,
      color: new Color4(flash.r * data.flashGlow, flash.g * data.flashGlow, flash.b * data.flashGlow, 1),
      colorEnd: new Color4(flash.r, flash.g, flash.b, 0),
      size: [data.flashSize, data.flashSize],
      gravity: 0,
      stretched: false,
      essential: true,
    });
  }

  /** How many times a trap went off. */
  get count(): number {
    return this.blasts;
  }

  /** Live spark particles (tests). */
  get activeSparks(): number {
    return this.sparks.activeCount;
  }

  /** Sparks, flash, sound and shake at `at` (world). */
  blast(at: Vector3): void {
    const d = this.data;
    for (let i = 0; i < d.sparks; i++) {
      const direction = new Vector3(this.random.range(-1, 1), this.random.range(-1, 1) + UPWARD_BIAS, this.random.range(-1, 1))
        .scaleInPlace(d.spread)
        .normalize();
      const speed = this.random.range(d.sparkSpeed[0], d.sparkSpeed[1]);
      this.sparks.emit({ position: at.clone(), velocity: direction.scaleInPlace(speed), life: this.random.range(d.sparkLife[0], d.sparkLife[1]) });
    }
    this.flash.emit({ position: at.clone(), velocity: Vector3.Zero(), life: d.flashTime });
    this.sounds.play(d.sound);
    this.player.camera.kick(SHAKE_CHANNEL, d.shake, FULL_STRENGTH);
    this.blasts++;
  }

  dispose(): void {
    this.sparks.dispose();
    this.flash.dispose();
  }
}
