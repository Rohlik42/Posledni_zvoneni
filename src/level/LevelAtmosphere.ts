import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { SynthSounds } from "../audio/SynthSounds";
import type { DamageType } from "../core/DamageTypes";
import type { Game } from "../core/Game";
import { TestHooks } from "../core/TestHooks";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { Player } from "../player/Player";
import type { QuizSystem } from "../quiz/QuizSystem";
import { NightEnvironment } from "../rendering/NightEnvironment";
import { PointShadows, type ShadowCandidate } from "../rendering/PointShadows";
import { RenderingConfig } from "../rendering/RenderingConfig";
import { AtmosphereConfig } from "./AtmosphereConfig";
import { DamageSparks } from "./DamageSparks";
import { DetailsConfig } from "./DetailsConfig";
import { FireEffects } from "./FireEffects";
import type { Level } from "./Level";
import { LightAnimator } from "./LightAnimator";
import { LooseDebris } from "./LooseDebris";
import type { RoomLighting } from "./RoomLighting";

/** Light kinds whose shadows are worth a cube map (emergency lamps are too dim). */
const SHADOW_KINDS = new Set(["fluorescent", "fire"]);
/** Name part of the merged detail meshes (`StaticGeometry`), so tests can count them. */
const DETAIL_MESH = ":detail";
/** Seed offsets of the parts, all derived from `atmosphere.json → seed`. */
const FIRE_SEED = 1;
const SPARK_SEED = 2;
/** Name of the scene's ambient light (`Game.addAmbientLight`). */
const AMBIENT_LIGHT = "ambient";

/** `window.__game.visuals` — the visual pass of phase 19. */
export interface VisualsTestApi {
  /** Generated detail meshes (rubble, cables, decals…) per room and their triangles. */
  details: () => { meshes: number; triangles: number; rooms: Record<string, number> };
  readonly fires: number;
  fireParticles: () => number;
  readonly crackles: number;
  /** Lights animated by `LightAnimator` and their current level (share of full intensity). */
  readonly animatedLights: number;
  lightLevels: () => Record<string, number>;
  /** Names of the lights casting shadows now (at most `rendering.json → shadows.maxLights`). */
  shadowLights: () => string[];
  /** Switches the point-light shadows on or off (quality presets, phase 21; A/B checks). */
  setShadows: (enabled: boolean) => void;
  /** Visible world meshes no point light reaches (DoD §15; must stay empty in the full game). */
  unlit: () => string[];
  readonly environment: boolean;
  readonly sparkBursts: number;
  sparkAt: (x: number, y: number, z: number) => void;
  /** Loose Havok debris (full game only): kind, room, still hanging, distance moved from the start, pushes. */
  debris: () => {
    kind: string;
    room: string;
    hanging: boolean;
    moved: number;
    pushes: number;
    position: { x: number; y: number; z: number };
    /** Centre of the drawn piece (aim here). */
    center: { x: number; y: number; z: number };
  }[];
  /** Hits a debris piece as a weapon would (`amount` of `type` from the player's eyes). */
  hitDebris: (index: number, amount: number, type: DamageType) => void;
  /** A blast (trap, robot death) at a world point. */
  blast: (x: number, y: number, z: number) => void;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    visuals: VisualsTestApi;
  }
}

/** What the full game adds to the atmosphere: loose debris (blown away by the quiz trap). */
export interface AtmosphereGameParts {
  quiz: QuizSystem | null;
}

/**
 * The living look of the level (phase 19): flickering tubes, wavering fires and breathing emergency lamps
 * (`LightAnimator`), fire particles with crackle (`FireEffects`), sparks from damaged robots and failing tubes
 * (`DamageSparks`), shadows of the nearest point lights (`PointShadows`), the procedural night environment
 * (`NightEnvironment`) and, in the full game, loose Havok debris (`LooseDebris`). Static details are generated with
 * the level (`DetailGenerator`). Created by `LevelGameplay` for the bare level and the full game alike.
 */
export class LevelAtmosphere {
  readonly lights: LightAnimator;
  readonly fires: FireEffects;
  readonly sparks: DamageSparks;
  readonly shadows: PointShadows;
  readonly environment: NightEnvironment;
  readonly debris: LooseDebris | null;
  private readonly removeSystem: () => void;

  constructor(game: Game, level: Level, lighting: RoomLighting, player: Player, enemies: EnemyManager | null, parts: AtmosphereGameParts | null) {
    const data = AtmosphereConfig.load();
    const scene = game.scene;
    // Quake 1 dark: the level is lit by its lamps and fires, the shared ambient only keeps black from being pitch black.
    const ambient = scene.getLightByName(AMBIENT_LIGHT);
    if (ambient !== null) ambient.intensity *= data.ambientScale;
    const eye = (): Vector3 => player.eyePosition;
    this.sparks = new DamageSparks(scene, data.sparks, () => enemies?.enemies ?? [], data.seed + SPARK_SEED);
    this.lights = new LightAnimator(level, data.flicker, data.seed, (at) => this.sparks.burst(at));
    this.fires = new FireEffects(scene, level.layout, data.fire, SynthSounds.for(game), eye, data.seed + FIRE_SEED);
    // Only lights shining into the player's room cast shadows (a lamp one floor down is near, but not seen).
    const candidates = LevelAtmosphere.shadowCandidates(level);
    const inRoom = (): ShadowCandidate[] => {
      const room = lighting.roomAt(eye());
      const lights = room === null ? [] : level.lightsFor(room);
      return candidates.filter((c) => lights.includes(c.light));
    };
    this.shadows = new PointShadows(RenderingConfig.load().shadows, inRoom, eye);
    this.environment = new NightEnvironment(scene, data.environment);
    const glass = level.materials.get(level.layout.greybox.windows.glassMaterial);
    glass.reflectionTexture = this.environment.texture;
    glass.reflectionTexture.level = data.environment.glassReflection;
    this.debris = parts === null ? null : new LooseDebris(scene, level, lighting, DetailsConfig.load().loose, eye);
    if (this.debris !== null) {
      const debris = this.debris;
      parts?.quiz?.onTrapBlast.add((at) => debris.blast(at));
      enemies?.onEnemyDeath.add((enemy) => debris.blast(enemy.center));
    }
    this.removeSystem = game.addSystem({
      update: (dt) => {
        this.lights.update(dt);
        this.fires.update(dt);
        this.sparks.update(dt);
        this.shadows.update(dt);
      },
    });
    this.registerTestHooks(level, scene);
  }

  dispose(): void {
    this.removeSystem();
    this.fires.dispose();
    this.sparks.dispose();
    this.shadows.dispose();
    this.debris?.dispose();
  }

  /**
   * DoD §15 „no visible element is an untextured primitive without light“: names of visible, lit-material meshes of the
   * world (rendering group 0) that no point light reaches, so only the dim ambient shows them. Self-lit materials
   * (fixtures, neon, sky) and the weapon in hand (group 1) do not count.
   */
  static unlit(scene: Scene): string[] {
    const reached = new Set<AbstractMesh>();
    for (const light of scene.lights) if (light.getClassName() === "PointLight") for (const mesh of light.includedOnlyMeshes) reached.add(mesh);
    return scene.meshes
      .filter((mesh) => mesh.isEnabled() && mesh.isVisible && mesh.renderingGroupId === 0 && mesh.getTotalVertices() > 0 && mesh.material !== null)
      .filter((mesh) => (mesh.material as { disableLighting?: boolean }).disableLighting !== true && !reached.has(mesh))
      .map((mesh) => mesh.name);
  }

  /** Tubes and fires; casters are what each light shines on except the level shell and the weapon in hand. */
  private static shadowCandidates(level: Level): ShadowCandidate[] {
    const shell = new Set<AbstractMesh>();
    for (const owned of level.geometry.owners.values()) for (const mesh of owned.visible) shell.add(mesh);
    const kinds = new Map(level.layout.level.lights.map((l) => [`light:${l.id}`, l.kind]));
    return level.lights
      .filter((light: PointLight) => SHADOW_KINDS.has(kinds.get(light.name) ?? ""))
      .map((light) => ({
        light,
        casters: () => light.includedOnlyMeshes.filter((mesh) => !shell.has(mesh) && mesh.renderingGroupId === 0 && mesh.isEnabled() && mesh.isVisible),
      }));
  }

  private registerTestHooks(level: Level, scene: Scene): void {
    const atmosphere = this;
    TestHooks.register("visuals", {
      unlit: () => LevelAtmosphere.unlit(scene),
      details: () => {
        const rooms: Record<string, number> = {};
        let meshes = 0;
        let triangles = 0;
        for (const [owner, owned] of level.geometry.owners) {
          for (const mesh of owned.visible) {
            if (!mesh.name.endsWith(DETAIL_MESH)) continue;
            const t = mesh.getTotalIndices() / 3;
            meshes += 1;
            triangles += t;
            rooms[owner] = (rooms[owner] ?? 0) + t;
          }
        }
        return { meshes, triangles, rooms };
      },
      fires: this.fires.count,
      fireParticles: () => atmosphere.fires.particles,
      get crackles() {
        return atmosphere.fires.crackleCount;
      },
      animatedLights: this.lights.count,
      lightLevels: () => atmosphere.lights.levels(),
      shadowLights: () => atmosphere.shadows.lights(),
      setShadows: (enabled) => atmosphere.shadows.setEnabled(enabled),
      get environment() {
        return level.layout !== null && atmosphere.environment.texture.isReady();
      },
      get sparkBursts() {
        return atmosphere.sparks.burstCount;
      },
      sparkAt: (x, y, z) => atmosphere.sparks.burst(new Vector3(x, y, z)),
      debris: () =>
        (atmosphere.debris?.pieces ?? []).map((p, i) => ({
          kind: p.item.kind,
          room: p.item.room,
          hanging: p.hanging,
          moved: atmosphere.debris!.moved()[i]!,
          pushes: p.pushes,
          position: { x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z },
          center: (({ x, y, z }) => ({ x, y, z }))(p.mesh.getBoundingInfo().boundingBox.centerWorld),
        })),
      hitDebris: (index, amount, type) => {
        const piece = atmosphere.debris?.pieces[index];
        if (piece !== undefined) atmosphere.debris!.hit(piece, amount, type);
      },
      blast: (x, y, z) => atmosphere.debris?.blast(new Vector3(x, y, z)),
    });
  }
}
