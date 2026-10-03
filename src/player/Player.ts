import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "../core/Game";
import type { Physics } from "../core/Physics";
import { TestHooks } from "../core/TestHooks";
import { DamageOverlay } from "../ui/DamageOverlay";
import { PlayerCamera } from "./PlayerCamera";
import { PlayerConfig, type PlayerData } from "./PlayerConfig";
import { PlayerController } from "./PlayerController";
import { PlayerHealth, type DamageType } from "./PlayerHealth";

const MS_PER_SECOND = 1000;

export interface PlayerSpawn {
  /** Feet position. */
  position: Vector3;
  /** Heading in radians (0 = +z). */
  yaw?: number;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** `window.__game.player` — read the state, move the player, hurt it. Positions are at the feet, in metres. */
export interface PlayerTestApi {
  readonly position: Vec3Like;
  readonly velocity: Vec3Like;
  readonly eye: Vec3Like;
  readonly health: number;
  readonly maxHealth: number;
  readonly grounded: boolean;
  readonly sprinting: boolean;
  readonly yaw: number;
  readonly pitch: number;
  /** Camera roll in radians; always 0 (the horizon stays level, LEGACY §7). */
  readonly roll: number;
  readonly fov: number;
  /** Opacity 0–1 of the red damage edges. */
  readonly damageOverlay: number;
  readonly deaths: number;
  teleport: (x: number, y: number, z: number) => void;
  /** Turns the view towards a world point (from the eye). */
  lookAt: (x: number, y: number, z: number) => void;
  damage: (amount: number, type?: DamageType) => number;
  heal: (amount: number) => number;
  /** Turns the view at a point or at anything with a `center` (e.g. `__game.enemies.get(id)`), phase 5. */
  aimAt: (target: Vec3Like | { center: Vec3Like }) => void;
  /** Camera shake: this frame's offset, the largest since `resetShakePeak` (m) and whether a shake runs. */
  shake: () => { offset: number; peak: number; active: boolean };
  resetShakePeak: () => void;
}

declare module "../core/TestHooks" {
  interface GameTestModules {
    player: PlayerTestApi;
  }
}

/**
 * The player: Havok character controller + first-person camera + health + red damage edges, wired to the game's
 * fixed step (movement) and render frame (look, camera effects). `Player.create` makes its camera the active one.
 */
export class Player {
  readonly data: PlayerData;
  readonly controller: PlayerController;
  readonly camera: PlayerCamera;
  readonly health: PlayerHealth;
  readonly overlay: DamageOverlay;

  private readonly removeSystem: () => void;
  private readonly frameObserver: Observer<Scene>;
  private readonly interpolatedFeet = Vector3.Zero();
  private deathCount = 0;

  private constructor(
    private readonly game: Game,
    physics: Physics,
    spawn: PlayerSpawn,
  ) {
    this.data = PlayerConfig.load();
    this.camera = new PlayerCamera(game.scene, this.data.camera);
    this.camera.setAngles(spawn.yaw ?? 0, 0);
    this.controller = new PlayerController(physics, game.input, this.data.body, this.data.movement, () => this.camera.yaw, spawn.position);
    this.health = new PlayerHealth(this.data.health.max);
    this.overlay = new DamageOverlay(game.canvas, this.data.damageOverlay);

    this.controller.onLanded.add((impact) => this.camera.land(impact));
    this.health.onDamaged.add(({ amount }) => {
      this.camera.hit(amount / this.data.damageOverlay.fullAtDamage);
      this.overlay.flash(amount);
    });
    this.health.onDeath.add(() => this.deathCount++);

    this.removeSystem = game.addSystem(this.controller);
    this.frameObserver = game.scene.onBeforeRenderObservable.add(() => this.frame());
    game.useCamera(this.camera.camera);
    this.frame();
    this.registerTestHooks();
  }

  static create(game: Game, physics: Physics, spawn: PlayerSpawn): Player {
    return new Player(game, physics, spawn);
  }

  /** Eye position of the latest simulated state (not interpolated). */
  get eyePosition(): Vector3 {
    const feet = this.controller.position;
    return new Vector3(feet.x, feet.y + this.data.body.eyeHeight, feet.z);
  }

  /** Moves the player to `spawn` with full health. */
  respawn(spawn: PlayerSpawn): void {
    this.controller.teleport(spawn.position);
    this.camera.setAngles(spawn.yaw ?? this.camera.yaw, 0);
    this.health.reset();
    this.overlay.clear();
  }

  dispose(): void {
    this.removeSystem();
    this.game.scene.onBeforeRenderObservable.remove(this.frameObserver);
    this.controller.dispose();
    this.camera.dispose();
    this.health.dispose();
    this.overlay.dispose();
  }

  private frame(): void {
    const look = this.game.input.consumeLook();
    const paused = this.game.paused;
    if (!paused && !this.health.isDead) this.camera.look(look);
    const frameDt = paused ? 0 : this.game.engine.getDeltaTime() / MS_PER_SECOND;
    Vector3.LerpToRef(this.controller.previousPosition, this.controller.position, this.game.stepAlpha, this.interpolatedFeet);
    this.camera.update(frameDt, {
      feet: this.interpolatedFeet,
      eyeHeight: this.data.body.eyeHeight,
      grounded: this.controller.isGrounded,
      sprinting: this.controller.isSprinting,
      speed: this.controller.speed,
      walkSpeed: this.controller.walkSpeed,
    });
    this.overlay.update(frameDt, this.health.health / this.health.max);
  }

  private registerTestHooks(): void {
    const player = this;
    const plain = (v: Vector3): Vec3Like => ({ x: v.x, y: v.y, z: v.z });
    TestHooks.register("player", {
      get position() {
        return plain(player.controller.position);
      },
      get velocity() {
        return plain(player.controller.currentVelocity);
      },
      get eye() {
        return plain(player.eyePosition);
      },
      get health() {
        return player.health.health;
      },
      get maxHealth() {
        return player.health.max;
      },
      get grounded() {
        return player.controller.isGrounded;
      },
      get sprinting() {
        return player.controller.isSprinting;
      },
      get yaw() {
        return player.camera.yaw;
      },
      get pitch() {
        return player.camera.pitch;
      },
      get roll() {
        return player.camera.camera.rotation.z;
      },
      get fov() {
        return player.camera.camera.fov;
      },
      get damageOverlay() {
        return player.overlay.opacity;
      },
      get deaths() {
        return player.deathCount;
      },
      teleport: (x, y, z) => {
        player.controller.teleport(new Vector3(x, y, z));
        player.frame();
      },
      lookAt: (x, y, z) => {
        player.camera.lookAt(player.eyePosition, new Vector3(x, y, z));
        player.frame();
      },
      damage: (amount, type) => player.health.damage(amount, type),
      heal: (amount) => player.health.heal(amount),
      aimAt: (target) => {
        const point = "center" in target ? target.center : target;
        player.camera.lookAt(player.eyePosition, new Vector3(point.x, point.y, point.z));
        player.frame();
      },
      shake: () => ({ offset: player.camera.shake.offset, peak: player.camera.shake.peak, active: player.camera.shake.active }),
      resetShakePeak: () => player.camera.shake.resetPeak(),
    });
  }
}
