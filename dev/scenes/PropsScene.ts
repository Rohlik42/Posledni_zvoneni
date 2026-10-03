import type { Game } from "../../src/core/Game";
import { TestHooks } from "../../src/core/TestHooks";
import { LevelGameplay } from "../../src/level/LevelGameplay";
import { PropPlacer } from "../../src/level/PropPlacer";
import { BlueprintGeometry } from "../../src/rendering/BlueprintGeometry";
import { ModelBlueprints } from "../../src/rendering/ModelBlueprints";

export const id = "props";
export const title =
  "Škola z level.json s rekvizitami z data/props.json (PropPlacer, thin instances; ?room=<id> začne v místnosti, ?yaw=<stupně> otočí pohled). Do levelu je napojí fáze 16.";

export interface PropsRoomInfo {
  room: string;
  instances: number;
  meshes: number;
  /** Drawn triangles of the room's props (thin instances counted). */
  triangles: number;
  /** The same from the blueprints without the engine (`PropLayout`), must match `triangles`. */
  expectedTriangles: number;
  /** Triangles of the room's level geometry. */
  geometryTriangles: number;
}

/** `window.__game.props` — what the props dev scene placed. */
export interface PropsTestApi {
  rooms: () => PropsRoomInfo[];
}

declare module "../../src/core/TestHooks" {
  interface GameTestModules {
    props: PropsTestApi;
  }
}

export async function create(game: Game): Promise<void> {
  const gameplay = await LevelGameplay.create(game, LevelGameplay.optionsFromUrl(window.location.search));
  const placed = PropPlacer.place(game.scene, gameplay.level.layout);
  for (const [room, meshes] of placed.meshesByRoom) gameplay.lighting.attach(meshes, [room]);
  const rooms = (): PropsRoomInfo[] =>
    placed.props.rooms().map((room) => {
      const instances = placed.props.inRoom(room);
      return {
        room,
        instances: instances.length,
        meshes: placed.meshesByRoom.get(room)?.length ?? 0,
        triangles: placed.triangles(room),
        expectedTriangles: instances.reduce((sum, i) => sum + BlueprintGeometry.triangles(ModelBlueprints.blueprint(i.blueprint)), 0),
        geometryTriangles: gameplay.level.geometry.triangles(room),
      };
    });
  TestHooks.register("props", { rooms });
}
