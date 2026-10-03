import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "../src/core/Game";
import type { Physics } from "../src/core/Physics";
import { PaletteColor } from "../src/rendering/PaletteColor";
import type { PlayerSpawn } from "../src/player/Player";
import { Palette } from "../src/utils/Palette";
import { BoxRoomData, type BoxRoomBox, type BoxRoomLayout, type BoxRoomRamp, type BoxRoomStairs } from "./BoxRoomData";

/** Pixels per checker tile in the floor texture (two tiles per side). */
const CHECKER_TILE_PX = 64;
const CHECKER_TILES_PER_TEXTURE = 2;
/** The hemispheric ambient light counts against the material light limit too. */
const AMBIENT_LIGHTS = 1;

/**
 * The 20×20×5 m test room from `data/boxroom.json`: walls, a door opening with an alcove behind it, stairs, a ramp,
 * pillars and boxes to jump on. Every solid part is a static Havok collider. Dev scenes of phases 2–5 build it with
 * `BoxRoom.build(game, physics)` and put their player, weapons or robots in it.
 */
export class BoxRoom {
  readonly meshes: Mesh[] = [];
  readonly lights: PointLight[] = [];
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly maxLights: number;

  private constructor(
    private readonly scene: Scene,
    private readonly physics: Physics,
    readonly layout: BoxRoomLayout,
  ) {
    this.maxLights = layout.lights.length + AMBIENT_LIGHTS;
  }

  static build(game: Game, physics: Physics, layout: BoxRoomLayout = BoxRoomData.load()): BoxRoom {
    const room = new BoxRoom(game.scene, physics, layout);
    game.addAmbientLight();
    room.buildFloor();
    for (const box of layout.boxes) room.addBox(box);
    for (const stairs of layout.stairs) room.addStairs(stairs);
    for (const ramp of layout.ramps) room.addRamp(ramp);
    room.addLights();
    return room;
  }

  /** Where the player starts (feet). */
  get spawn(): PlayerSpawn {
    return { position: Vector3.FromArray(this.layout.spawn.position), yaw: this.layout.spawn.yaw };
  }

  private buildFloor(): void {
    const { floor } = this.layout;
    const [width, height, depth] = floor.size;
    const collider = MeshBuilder.CreateBox(`${floor.name}-collider`, { width, height, depth }, this.scene);
    collider.position = Vector3.FromArray(floor.position);
    collider.isVisible = false;
    this.physics.addStatic(collider);
    this.meshes.push(collider);

    const top = floor.position[1] + height / 2;
    const ground = MeshBuilder.CreateGround(floor.name, { width, height: depth }, this.scene);
    ground.position.set(floor.position[0], top, floor.position[2]);
    const material = this.matte(`${floor.color}+${floor.altColor}`, floor.color);
    const texture = this.checkerTexture(floor.color, floor.altColor);
    texture.uScale = width / (floor.tileSize * CHECKER_TILES_PER_TEXTURE);
    texture.vScale = depth / (floor.tileSize * CHECKER_TILES_PER_TEXTURE);
    material.diffuseTexture = texture;
    material.diffuseColor = Color3.White();
    ground.material = material;
    this.meshes.push(ground);
  }

  private addBox(box: BoxRoomBox): Mesh {
    const [width, height, depth] = box.size;
    const mesh = MeshBuilder.CreateBox(box.name, { width, height, depth }, this.scene);
    mesh.position = Vector3.FromArray(box.position);
    mesh.rotation.y = box.rotationY ?? 0;
    mesh.material = this.matte(box.color, box.color);
    if (box.collide ?? true) this.physics.addStatic(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  /** Solid steps from the floor up: step i is `(i + 1) × rise` tall and starts `i × run` along the heading. */
  private addStairs(stairs: BoxRoomStairs): void {
    const [x, y, z] = stairs.start;
    const sin = Math.sin(stairs.yaw);
    const cos = Math.cos(stairs.yaw);
    for (let i = 0; i < stairs.count; i++) {
      const height = (i + 1) * stairs.rise;
      const along = (i + 0.5) * stairs.run;
      this.addBox({
        name: `${stairs.name}-${i}`,
        position: [x + sin * along, y + height / 2, z + cos * along],
        size: [stairs.width, height, stairs.run],
        rotationY: stairs.yaw,
        color: stairs.color,
      });
    }
  }

  /** A tilted slab whose top surface runs from the floor at `start` up `rise` over `run`. */
  private addRamp(ramp: BoxRoomRamp): void {
    const angle = Math.atan2(ramp.rise, ramp.run);
    const length = Math.hypot(ramp.run, ramp.rise);
    const sin = Math.sin(ramp.yaw);
    const cos = Math.cos(ramp.yaw);
    // Top-surface centre, then half the thickness down along the slab's normal.
    const normalHorizontal = -Math.sin(angle) * (ramp.thickness / 2);
    const normalUp = Math.cos(angle) * (ramp.thickness / 2);
    const along = ramp.run / 2 - normalHorizontal;
    const mesh = MeshBuilder.CreateBox(ramp.name, { width: ramp.width, height: ramp.thickness, depth: length }, this.scene);
    mesh.position.set(ramp.start[0] + sin * along, ramp.start[1] + ramp.rise / 2 - normalUp, ramp.start[2] + cos * along);
    // Negative pitch raises the +z end (Babylon rotates +x pitch downwards); yaw then turns the whole slab.
    mesh.rotation.set(-angle, ramp.yaw, 0);
    mesh.material = this.matte(ramp.color, ramp.color);
    this.physics.addStatic(mesh);
    this.meshes.push(mesh);
  }

  private addLights(): void {
    this.layout.lights.forEach((light, i) => {
      const point = new PointLight(`boxroom-light${i}`, Vector3.FromArray(light.position), this.scene);
      point.diffuse = PaletteColor.color3(light.color);
      point.specular = Color3.Black();
      point.intensity = light.intensity;
      point.range = light.range;
      this.lights.push(point);
    });
    this.layout.panels.forEach((panel, i) => {
      const [width, height, depth] = panel.size;
      const mesh = MeshBuilder.CreateBox(`boxroom-panel${i}`, { width, height, depth }, this.scene);
      mesh.position = Vector3.FromArray(panel.position);
      const material = new StandardMaterial(`boxroom-glow${i}`, this.scene);
      material.diffuseColor = Color3.Black();
      material.specularColor = Color3.Black();
      material.emissiveColor = PaletteColor.emissive(panel.color, panel.emissive);
      material.disableLighting = true;
      mesh.material = material;
      this.meshes.push(mesh);
    });
  }

  private matte(key: string, color: string): StandardMaterial {
    let material = this.materials.get(key);
    if (material === undefined) {
      material = new StandardMaterial(`boxroom-${key}`, this.scene);
      material.diffuseColor = PaletteColor.color3(color);
      material.specularColor = Color3.Black();
      material.maxSimultaneousLights = this.maxLights;
      this.materials.set(key, material);
    }
    return material;
  }

  private checkerTexture(color: string, altColor: string): DynamicTexture {
    const size = CHECKER_TILE_PX * CHECKER_TILES_PER_TEXTURE;
    const texture = new DynamicTexture("boxroom-checker", { width: size, height: size }, this.scene, true, Texture.NEAREST_SAMPLINGMODE);
    const ctx = texture.getContext();
    for (let row = 0; row < CHECKER_TILES_PER_TEXTURE; row++) {
      for (let col = 0; col < CHECKER_TILES_PER_TEXTURE; col++) {
        ctx.fillStyle = Palette.hex((row + col) % 2 === 0 ? color : altColor);
        ctx.fillRect(col * CHECKER_TILE_PX, row * CHECKER_TILE_PX, CHECKER_TILE_PX, CHECKER_TILE_PX);
      }
    }
    texture.update();
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    return texture;
  }
}
