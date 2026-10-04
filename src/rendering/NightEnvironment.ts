import { Constants } from "@babylonjs/core/Engines/constants";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { EnvironmentData } from "../level/AtmosphereConfig";
import { Random } from "../utils/Random";
import { PaletteColor } from "./PaletteColor";

const RGBA = 4;
const BYTE = 255;
const HALF_PI = Math.PI / 2;
const FULL_TURN = Math.PI * 2;
/** Fire glow fades with elevation over this angle (rad); smoke is densest just above the horizon. */
const GLOW_HEIGHT = 0.3;
const SMOKE_HEIGHT = 0.6;
const SMOKE_MIX = 0.55;
/** Below the horizon the ground is the zenith colour with a little of the glow (burning streets). */
const GROUND_GLOW = 0.25;
/** Smoke bands: waves per turn and slope of each band (random in these ranges). */
const BAND_FREQUENCY: readonly [number, number] = [1, 5];
const BAND_TILT = 2;
/** Cube faces in Babylon's order (+x, −x, +y, −y, +z, −z): direction of a face pixel (u, v in −1..1). */
const FACES: ReadonlyArray<(u: number, v: number) => [number, number, number]> = [
  (u, v) => [1, -v, -u],
  (u, v) => [-1, -v, u],
  (u, v) => [u, 1, v],
  (u, v) => [u, -1, -v],
  (u, v) => [u, -v, 1],
  (u, v) => [-u, -v, -1],
];

/**
 * A procedural night sky over a burning city (phase 19, DESIGN §13 fallback „procedurální gradient + kouř“): dark
 * zenith, smoky horizon bands and orange glows of fires at a few azimuths, drawn into a small cube texture from
 * `data/atmosphere.json → environment`. It becomes `scene.environmentTexture` (reflections) instead of a downloaded HDR
 * and is reflected faintly in the window glass. The view out of the windows stays the Prague skybox (phase F1).
 */
export class NightEnvironment {
  readonly texture: RawCubeTexture;

  constructor(scene: Scene, data: EnvironmentData) {
    const zenith = PaletteColor.color3(data.zenith);
    const horizon = PaletteColor.color3(data.horizon);
    const smoke = PaletteColor.color3(data.smoke);
    const glow = PaletteColor.color3(data.glow);
    const random = new Random(data.seed);
    const bands = Array.from({ length: data.smokeBands }, () => ({ frequency: random.range(BAND_FREQUENCY[0], BAND_FREQUENCY[1]), phase: random.next() * FULL_TURN, tilt: random.range(-BAND_TILT, BAND_TILT) }));
    const size = data.px;
    const faces = FACES.map((direction) => {
      const pixels = new Uint8Array(size * size * RGBA);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const [dx, dy, dz] = direction(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1);
          const length = Math.hypot(dx, dy, dz);
          const elevation = Math.asin(dy / length);
          const azimuth = Math.atan2(dx, dz);
          const c = NightEnvironment.sky(elevation, azimuth, zenith, horizon, smoke, glow, bands, data);
          const i = (y * size + x) * RGBA;
          pixels[i] = Math.round(Math.min(1, c[0]) * BYTE);
          pixels[i + 1] = Math.round(Math.min(1, c[1]) * BYTE);
          pixels[i + 2] = Math.round(Math.min(1, c[2]) * BYTE);
          pixels[i + 3] = BYTE;
        }
      }
      return pixels;
    });
    this.texture = new RawCubeTexture(scene, faces, size, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, false, false, Texture.BILINEAR_SAMPLINGMODE);
    this.texture.name = "night-environment";
    scene.environmentTexture = this.texture;
  }

  private static sky(
    elevation: number,
    azimuth: number,
    zenith: Color3,
    horizon: Color3,
    smoke: Color3,
    glow: Color3,
    bands: readonly { frequency: number; phase: number; tilt: number }[],
    data: EnvironmentData,
  ): [number, number, number] {
    let glowAmount = 0;
    for (const a of data.glows) {
      let delta = Math.abs(azimuth - a) % FULL_TURN;
      if (delta > Math.PI) delta = FULL_TURN - delta;
      glowAmount += Math.exp(-((delta / data.glowWidth) ** 2));
    }
    if (elevation < 0) {
      const g = glowAmount * data.glowStrength * GROUND_GLOW;
      return [zenith.r + glow.r * g, zenith.g + glow.g * g, zenith.b + glow.b * g];
    }
    const t = Math.min(1, elevation / HALF_PI);
    const base = [horizon.r + (zenith.r - horizon.r) * t, horizon.g + (zenith.g - horizon.g) * t, horizon.b + (zenith.b - horizon.b) * t];
    let density = 0;
    for (const band of bands) density += 0.5 + 0.5 * Math.sin(azimuth * band.frequency + elevation * band.tilt * 4 + band.phase);
    density = (density / Math.max(1, bands.length)) * Math.exp(-elevation / SMOKE_HEIGHT) * SMOKE_MIX;
    const g = glowAmount * data.glowStrength * Math.exp(-elevation / GLOW_HEIGHT);
    return [
      base[0]! + (smoke.r - base[0]!) * density + glow.r * g,
      base[1]! + (smoke.g - base[1]!) * density + glow.g * g,
      base[2]! + (smoke.b - base[2]!) * density + glow.b * g,
    ];
  }
}
