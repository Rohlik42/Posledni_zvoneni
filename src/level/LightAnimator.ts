import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Random } from "../utils/Random";
import type { FlickerData } from "./AtmosphereConfig";
import type { Level } from "./Level";
import { LevelLayout } from "./LevelLayout";
import type { Light } from "./LevelTypes";

const FULL_TURN = Math.PI * 2;
/** Fixtures hang this far below the ceiling: sparks start there (m). */
const FIXTURE_DROP = 0.05;
/** Fire flicker: two sine waves of `fire.speed` around the middle; the second runs at this phase ratio. */
const FIRE_WAVE = { middle: 0.5, amplitude: 0.25, phaseRatio: 1.7 } as const;

type Mode = "tube" | "fire" | "emergency" | "steady";

interface Animated {
  data: Light;
  light: PointLight;
  base: number;
  mode: Mode;
  /** Glow material of the fixture (flickering tubes have their own) and its emissive at full power. */
  glow: StandardMaterial | null;
  glowBase: Color3 | null;
  /** Tube state: time left in the current phase, whether it is lit, stutters left before it settles on. */
  timer: number;
  on: boolean;
  stutters: number;
  phase: number;
  level: number;
  fixture: Vector3;
}

/**
 * Quake-style light life (phase 19): `flicker: true` fluorescent tubes on a damaged circuit stay lit for a while,
 * drop out, stutter back on and sometimes spit sparks (`onSpark`); fires waver around their intensity; emergency lamps
 * breathe slowly. Runs in the fixed simulation step (deterministic with `__game.step`, frozen in pause and menus),
 * seeded from `data/atmosphere.json`. Intensities scale the values `LevelBuilder` gave the lights; a flickering tube's
 * own glow material dims with it.
 */
export class LightAnimator {
  private readonly animated: Animated[] = [];
  private readonly random: Random;
  private time = 0;

  constructor(
    level: Level,
    private readonly data: FlickerData,
    seed: number,
    private readonly onSpark: (position: Vector3) => void,
  ) {
    this.random = new Random(seed);
    const layout = level.layout;
    const byId = new Map(level.lights.map((light) => [light.name.slice("light:".length), light]));
    for (const data of layout.level.lights) {
      const light = byId.get(data.id);
      if (light === undefined) continue;
      const mode: Mode = data.kind === "fire" ? "fire" : data.kind === "emergency" ? "emergency" : data.flicker ? "tube" : "steady";
      if (mode === "steady") continue;
      const fixture = layout.greybox.lights.fixtures[data.kind];
      const glow = data.flicker && fixture.size.every((s) => s > 0) ? level.materials.glow(data.color, fixture.emissive, data.id) : null;
      const room = layout.room(data.room);
      const top = layout.hasCeiling(room) ? layout.ceilingY(room) - FIXTURE_DROP : layout.floorY(room) + data.height;
      const p = LevelLayout.toWorld(data.x, top, data.z);
      this.animated.push({
        data,
        light,
        base: light.intensity,
        mode,
        glow,
        glowBase: glow?.emissiveColor.clone() ?? null,
        timer: this.random.range(0, data.flicker ? this.data.onTime[1] : 1),
        on: true,
        stutters: 0,
        phase: this.random.next() * FULL_TURN,
        level: 1,
        fixture: new Vector3(p.x, p.y, p.z),
      });
    }
  }

  /** Lights this animator drives (flickering tubes, fires, emergency lamps). */
  get count(): number {
    return this.animated.length;
  }

  /** Current level (share of the light's full intensity) of every animated light by id. */
  levels(): Record<string, number> {
    return Object.fromEntries(this.animated.map((a) => [a.data.id, a.level]));
  }

  update(dt: number): void {
    this.time += dt;
    for (const a of this.animated) {
      a.level = a.mode === "tube" ? this.tube(a, dt) : a.mode === "fire" ? this.fire(a) : this.emergency(a);
      a.light.intensity = a.base * a.level;
      if (a.glow !== null && a.glowBase !== null) a.glowBase.scaleToRef(a.level, a.glow.emissiveColor);
    }
  }

  private tube(a: Animated, dt: number): number {
    const d = this.data;
    a.timer -= dt;
    if (a.timer <= 0) {
      if (a.on && a.stutters === 0) {
        // Drop out: dark for a moment, then stutter back on.
        a.on = false;
        a.timer = this.random.range(d.offTime[0], d.offTime[1]);
        a.stutters = Math.round(this.random.range(d.stutters[0], d.stutters[1]));
        if (this.random.next() < d.sparkChance) this.onSpark(a.fixture);
      } else if (a.stutters > 0) {
        a.on = !a.on;
        if (a.on) a.stutters -= 1;
        a.timer = a.stutters === 0 && a.on ? this.random.range(d.onTime[0], d.onTime[1]) : this.random.range(d.stutterTime[0], d.stutterTime[1]);
      } else {
        a.on = true;
        a.timer = this.random.range(d.onTime[0], d.onTime[1]);
      }
    }
    if (!a.on) return d.offLevel;
    // While stuttering the tube does not reach full brightness.
    return a.stutters > 0 ? d.dimLevel : 1;
  }

  private fire(a: Animated): number {
    const f = this.data.fire;
    const t = this.time;
    const wave = FIRE_WAVE.middle + FIRE_WAVE.amplitude * Math.sin(t * f.speed[0] + a.phase) + FIRE_WAVE.amplitude * Math.sin(t * f.speed[1] + a.phase * FIRE_WAVE.phaseRatio);
    const noise = (this.random.next() - 0.5) * 2 * f.noise;
    return Math.min(f.max, Math.max(f.min, f.min + (f.max - f.min) * wave + noise));
  }

  private emergency(a: Animated): number {
    const e = this.data.emergency;
    return 1 - e.depth * (0.5 + 0.5 * Math.sin((this.time / e.period) * FULL_TURN + a.phase));
  }
}
