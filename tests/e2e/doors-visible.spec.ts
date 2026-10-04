import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ConsoleGuard } from "../support/ConsoleGuard";
import type { LevelData, Room } from "../../src/level/LevelTypes";

// FEEDBACK 2026-10-04 „První schodiště nahoře má neviditelné dveře, které musím otevřít“: the red door at the top of
// the middle stair (d-f4-stair-mid) — and the yellow door d-f3-yellow — were never drawn. Their leaves hang in the wall
// gap between two rooms, and the room lookup of RoomCulling placed the gap in the 1st-floor corridor two floors below,
// which is always „too far“, so the leaves were culled while the closed door's collider still stopped the player.
// On the main page, with room culling on as in the game: for every leaf door of level.json the player stands 2 m in
// front of it on both sides (clamped into the room, ≥ ROOM_MARGIN_M from its walls), looks at it, and every mesh of the
// leaf is enabled, visible, opaque, with a ready material and in the active mesh list of the rendered frame.

const level = JSON.parse(readFileSync("data/level.json", "utf8")) as LevelData;
const player = JSON.parse(readFileSync("data/player.json", "utf8")) as { body: { eyeHeight: number } };

const READY_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 180_000;
/** Distance from the door the player stands at (m). */
const STAND_OFF_M = 2;
/** The standing point keeps at least this far from the walls of its room (m). */
const ROOM_MARGIN_M = 0.4;
/** Fixed steps after the teleport (the player lands on the floor or the stair flight). */
const SETTLE_MS = 400;
/** Real time for the room culling to re-read the player's room (interval 0.1 s) and a few frames to render. */
const RENDER_WAIT_MS = 350;

interface Vec {
  x: number;
  y: number;
  z: number;
}

const floorY = (room: Room): number => level.floors.find((f) => f.id === room.floor)!.elevation + (room.elevation ?? 0);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Where to stand on `room`'s side of the door (plan → world: z flips) and the door's middle to look at. */
function spot(door: LevelData["doors"][number], room: Room): { feet: Vec; target: Vec } {
  const r = room.rect;
  const normalZ = door.along === "x";
  const towards = Math.sign(normalZ ? (r.z0 + r.z1) / 2 - door.z : (r.x0 + r.x1) / 2 - door.x);
  const px = clamp(normalZ ? door.x : door.x + towards * STAND_OFF_M, r.x0 + ROOM_MARGIN_M, r.x1 - ROOM_MARGIN_M);
  const pz = clamp(normalZ ? door.z + towards * STAND_OFF_M : door.z, r.z0 + ROOM_MARGIN_M, r.z1 - ROOM_MARGIN_M);
  const bottom = Math.max(...door.rooms.map((id) => floorY(level.rooms.find((x) => x.id === id)!)));
  return {
    feet: { x: px, y: floorY(room), z: -pz },
    target: { x: door.x, y: bottom + Math.min(door.height / 2, player.body.eyeHeight), z: -door.z },
  };
}

test("every door leaf is drawn when the player stands 2 m in front of it, on both sides (FEEDBACK: invisible door)", async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const guard = new ConsoleGuard(page);
  await page.goto("/?new=1");
  await page.waitForFunction(() => window.__game?.ready === true || window.__game?.error != null, undefined, { timeout: READY_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__game?.error ?? null)).toBeNull();
  await page.evaluate(() => {
    const g = window.__game!;
    g.progress?.intro.dismiss();
    g.setPaused(true);
  });
  expect(await page.evaluate(() => window.__game!.culling!.enabled), "room culling is on, as in the game").toBe(true);

  const doors = level.doors.filter((d) => d.kind === "door");
  expect(doors.map((d) => d.id)).toContain("d-f4-stair-mid");
  const failures: string[] = [];
  for (const door of doors) {
    for (const roomId of door.rooms) {
      const room = level.rooms.find((r) => r.id === roomId)!;
      const { feet, target } = spot(door, room);
      await page.evaluate(
        ({ feet, target, settle }) => {
          const g = window.__game!;
          g.player!.teleport(feet.x, feet.y, feet.z);
          g.step(settle);
          g.player!.lookAt(target.x, target.y, target.z);
          g.step(1);
        },
        { feet, target, settle: SETTLE_MS },
      );
      await page.waitForTimeout(RENDER_WAIT_MS);
      const leaf = await page.evaluate((id) => {
        window.__game!.step(1);
        return window.__game!.doors!.leafRender(id);
      }, door.id);
      if (leaf.length === 0) failures.push(`${door.id} from ${roomId}: no leaf meshes`);
      for (const mesh of leaf) {
        const problems = [
          mesh.enabled ? "" : "disabled",
          mesh.visible ? "" : "isVisible false",
          mesh.visibility > 0 ? "" : "visibility 0",
          mesh.alpha > 0 ? "" : `alpha ${mesh.alpha}`,
          mesh.materialReady ? "" : "material not ready",
          mesh.triangles > 0 ? "" : "no triangles",
          mesh.active ? "" : "not rendered (culled)",
        ].filter((p) => p !== "");
        if (problems.length > 0) failures.push(`${door.id} from ${roomId}: ${mesh.name} ${problems.join(", ")}`);
      }
    }
  }
  expect(failures).toEqual([]);
  expect(guard.problems).toEqual([]);
});
