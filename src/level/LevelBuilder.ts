import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { Material } from "@babylonjs/core/Materials/material";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Game } from "../core/Game";
import type { Physics } from "../core/Physics";
import { DecalTextures } from "../rendering/DecalTextures";
import { MaterialLibrary } from "../rendering/MaterialLibrary";
import { PaletteColor } from "../rendering/PaletteColor";
import { QualityManager } from "../rendering/QualityManager";
import { Skybox } from "../rendering/Skybox";
import { SkyboxConfig } from "../rendering/SkyboxConfig";
import type { PaletteKey } from "../utils/Palette";
import { GreyboxConfig, type GreyboxData } from "./GreyboxConfig";
import { DetailGenerator } from "./DetailGenerator";
import { FacadeBuilder } from "./FacadeBuilder";
import { PieceList, type PieceSink } from "./GreyboxTypes";
import { Level } from "./Level";
import { LevelConfig } from "./LevelConfig";
import { LevelLayout } from "./LevelLayout";
import type { LevelData } from "./LevelTypes";
import { OpeningBuilder } from "./OpeningBuilder";
import { OverlapResolver } from "./OverlapResolver";
import { RailingBuilder } from "./RailingBuilder";
import { StairBuilder } from "./StairBuilder";
import { StaticGeometry } from "./StaticGeometry";
import { WallBuilder } from "./WallBuilder";

/** Material ids of light fixtures: `glow:<palette key>:<emissive intensity>` (resolved by `MaterialLibrary.glow`). */
const GLOW_PREFIX = "glow:";
/** Name of the light on the façade skin (`greybox.json → lights.moon`); `LevelAtmosphere.unlit` counts it as reaching. */
export const FACADE_LIGHT = "moon";

/**
 * Builds the playable school from `data/level.json` (layout) and `data/greybox.json` (generator parameters): floors,
 * ceilings, walls with door and window openings, stairs with railings, rubble blockers, the gym court decal, point
 * lights with glowing fixtures. Geometry is generated as engine-free pieces first (`collect`, also used by the data
 * tests), then merged and given Havok colliders (`StaticGeometry`). No navmesh here: `Level.getNavigableMeshes()`
 * hands the walkable meshes to phase 10.
 */
export class LevelBuilder {
  /** All greybox pieces of the level, without the engine (also used by `tests/data/greybox.test.ts`). */
  static collect(layout: LevelLayout, textureRect?: (texture: string) => [number, number, number, number] | undefined): PieceList {
    const greybox = layout.greybox;
    const pieces = new PieceList();
    const railings = new RailingBuilder(greybox.railings, pieces);
    // Phase 19: some windows are smashed (no glass, shards), decided before the walls are built.
    const openings = new OpeningBuilder(layout, greybox, pieces, DetailGenerator.brokenWindows(layout));
    new WallBuilder(layout, greybox, pieces, railings, openings, new FacadeBuilder(layout, greybox, pieces)).build();
    const stairs = new StairBuilder(greybox.stairs, pieces, railings);
    for (const stair of layout.level.stairs) stairs.build(stair);
    openings.doorFrames();
    LevelBuilder.blockers(layout, pieces);
    LevelBuilder.fixtures(layout, pieces);
    if (textureRect !== undefined) LevelBuilder.decals(layout, pieces, textureRect);
    // Rubble, beams, cables, scorch marks, stains, plates, graffiti, shards (phase 19): drawn, not colliding, not pickable.
    DetailGenerator.generate(layout, pieces, pieces, openings.brokenPanes);
    return pieces;
  }

  static async build(game: Game, physics: Physics, level: LevelData = LevelConfig.load(), greybox: GreyboxData = GreyboxConfig.load()): Promise<Level> {
    const { scene } = game;
    const layout = new LevelLayout(level, greybox);
    const materials = await MaterialLibrary.load(scene);
    const collected = LevelBuilder.collect(layout, (id) => materials.textureEntry(id)?.plan?.rectPx);
    // Visible boxes are carved so none overlap (no coplanar faces = no z-fighting); colliders stay as built.
    const pieces = OverlapResolver.resolve(collected, greybox.audit.minPiece);
    const decals = new DecalTextures(scene, materials.data.maxLights);
    await DecalTextures.fontsReady();
    const resolve = (id: string): Material => {
      if (DecalTextures.isDecal(id)) return decals.material(id);
      if (!id.startsWith(GLOW_PREFIX)) return materials.get(id);
      const [color, intensity, key] = id.slice(GLOW_PREFIX.length).split(":");
      return materials.glow(color as PaletteKey, Number(intensity), key);
    };
    const geometry = StaticGeometry.build(scene, physics, pieces, resolve);
    game.addAmbientLight();
    // The view out of every window (no per-window pictures); its resolution follows the quality preset (phase 21).
    const quality = QualityManager.existing(game);
    const skybox = Skybox.create(scene, SkyboxConfig.load(), quality?.preset.skybox);
    if (skybox !== null) quality?.register({ applyQuality: (preset) => skybox.setFaceSize(preset.skybox) });
    const lightRooms = new Map<PointLight, string[]>();
    const lights = level.lights.map((light) => {
      const room = layout.room(light.room);
      const position = LevelLayout.toWorld(light.x, layout.floorY(room) + light.height, light.z);
      const point = new PointLight(`light:${light.id}`, new Vector3(position.x, position.y, position.z), scene);
      point.diffuse = PaletteColor.color3(light.color);
      point.specular = Color3.Black();
      point.intensity = light.intensity * greybox.lights.intensityScale;
      point.range = light.range * greybox.lights.rangeScale;
      // A light reaches only its own room's meshes (no shadows, so it would shine through walls), so each mesh stays
      // within the material light limit. A stairwell and the shaft above it are one open space.
      const stairwell = level.stairs.filter((s) => s.fromFloor !== s.toFloor && (s.bottomRoom === room.id || s.topRoom === room.id));
      const rooms = new Set([room.id, ...stairwell.flatMap((s) => [s.bottomRoom, s.topRoom])]);
      point.includedOnlyMeshes = [...rooms].flatMap((id) => geometry.owners.get(id)?.visible ?? []);
      lightRooms.set(point, [...rooms]);
      return point;
    });
    LevelBuilder.moon(scene, greybox, geometry);
    return new Level(layout, geometry, materials, lights, lightRooms);
  }

  /** Cool moonlight on the outer skin of the perimeter walls only (seen from the windows), never inside a room. */
  private static moon(scene: Scene, greybox: GreyboxData, geometry: StaticGeometry): void {
    const { moon } = greybox.lights;
    const skin = geometry.owners.get(greybox.walls.facade.owner)?.visible ?? [];
    // An empty includedOnlyMeshes means "every mesh": without a skin there is nothing to light.
    if (skin.length === 0) return;
    const light = new HemisphericLight(FACADE_LIGHT, new Vector3(...moon.direction), scene);
    light.diffuse = PaletteColor.color3(moon.color);
    light.groundColor = PaletteColor.color3(moon.ground);
    light.specular = Color3.Black();
    light.intensity = moon.intensity;
    light.includedOnlyMeshes = [...skin];
  }

  /** Rubble boxes standing on the room floor (collapsed-ceiling chunks the same until phase 19 details them). */
  private static blockers(layout: LevelLayout, sink: PieceSink): void {
    for (const blocker of layout.level.blockers) {
      const room = layout.room(blocker.room);
      const y = layout.floorY(room);
      const r = blocker.rect;
      sink.box({
        owner: room.id,
        material: layout.greybox.blockers.materials[blocker.kind],
        center: LevelLayout.toWorld((r.x0 + r.x1) / 2, y + blocker.height / 2, (r.z0 + r.z1) / 2),
        size: { x: r.x1 - r.x0, y: blocker.height, z: r.z1 - r.z0 },
        visible: true,
        collide: true,
        role: "fill",
      });
    }
  }

  /** A glowing box under each light (fluorescent tube, emergency lamp); fires get theirs in phase 19. */
  private static fixtures(layout: LevelLayout, sink: PieceSink): void {
    for (const light of layout.level.lights) {
      const fixture = layout.greybox.lights.fixtures[light.kind];
      const [sx, sy, sz] = fixture.size;
      if (sx <= 0 || sy <= 0 || sz <= 0) continue;
      const room = layout.room(light.room);
      const top = layout.hasCeiling(room) ? layout.ceilingY(room) : layout.floorY(room) + light.height + sy;
      sink.box({
        owner: room.id,
        // A flickering light gets its own fixture material, so the tube dims with it (`LightAnimator`).
        material: `${GLOW_PREFIX}${light.color}:${fixture.emissive}${light.flicker ? `:${light.id}` : ""}`,
        center: LevelLayout.toWorld(light.x, top - sy / 2, light.z),
        size: { x: sx, y: sy, z: sz },
        visible: true,
        collide: false,
      });
    }
  }

  /** Floor decals placed by their floorplan pixel rectangle (`plan.rectPx` in the texture index, 83 px/m). */
  private static decals(layout: LevelLayout, sink: PieceSink, textureRect: (texture: string) => [number, number, number, number] | undefined): void {
    const ppm = layout.level.plan.pxPerMeter;
    for (const decal of layout.greybox.decals) {
      const rect = textureRect(decal.texture);
      if (rect === undefined) continue;
      const [px, pz, pw, ph] = rect;
      const [x0, z0, x1, z1] = [px / ppm, pz / ppm, (px + pw) / ppm, (pz + ph) / ppm];
      const y = layout.floorY(layout.room(decal.room)) + decal.lift;
      sink.quad({
        owner: decal.room,
        material: decal.material,
        corners: [LevelLayout.toWorld(x0, y, z0), LevelLayout.toWorld(x1, y, z0), LevelLayout.toWorld(x1, y, z1), LevelLayout.toWorld(x0, y, z1)],
        facing: { x: 0, y: 1, z: 0 },
      });
    }
  }
}
