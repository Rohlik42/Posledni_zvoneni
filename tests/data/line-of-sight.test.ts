import { test } from "node:test";
import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { LineOfSight } from "../../src/enemies/ai/LineOfSight";
import { DamageTargets } from "../../src/core/DamageTargets";
import type { IDamageable } from "../../src/core/IDamageable";

/**
 * Phase 26 regression: the blocker cache of `LineOfSight` must notice a mesh whose flags change after it was added
 * (made pickable, linked to a damageable owner, world matrix unfrozen), not only meshes that are added or removed.
 * The check runs every 30 fixed steps (`SIGNATURE_CHECK_STEPS`); the tests step past it.
 */
const STEPS_PAST_CHECK = 31;
const RANGE = 10;
const WALL_Z = 5;
const OFF_RAY_X = 5;

function setup(): { scene: Scene; los: LineOfSight; dispose: () => void } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const los = new LineOfSight(scene);
  return { scene, los, dispose: () => { scene.dispose(); engine.dispose(); } };
}

function wall(scene: Scene, name: string, pickable: boolean): ReturnType<typeof MeshBuilder.CreateBox> {
  const box = MeshBuilder.CreateBox(name, { width: 2, height: 2, depth: 0.2 }, scene);
  box.position.z = WALL_Z;
  box.isPickable = pickable;
  box.computeWorldMatrix(true);
  return box;
}

const ray = (los: LineOfSight): number | null => los.firstHit(Vector3.Zero(), new Vector3(0, 0, 1), RANGE);
const steps = (los: LineOfSight, n: number): void => {
  for (let i = 0; i < n; i++) los.beginStep();
};

test("a mesh made pickable after it was added blocks the view after the signature check", (t) => {
  const { scene, los, dispose } = setup();
  t.after(dispose);
  const box = wall(scene, "late-pickable", false);
  assert.equal(ray(los), null, "non-pickable mesh does not block");
  box.isPickable = true;
  steps(los, STEPS_PAST_CHECK);
  const hit = ray(los);
  assert.notEqual(hit, null, "mesh made pickable later must block after the check");
  assert.ok(hit! > 0 && hit! < RANGE);
});

test("a mesh that gets a damageable owner stops blocking", (t) => {
  const { scene, los, dispose } = setup();
  t.after(dispose);
  const root = new TransformNode("robot-root", scene);
  const box = wall(scene, "robot-part", true);
  box.parent = root;
  box.computeWorldMatrix(true);
  assert.notEqual(ray(los), null, "plain pickable mesh blocks");
  const owner = { health: 1 } as unknown as IDamageable;
  DamageTargets.attach(root, owner);
  steps(los, STEPS_PAST_CHECK);
  assert.equal(ray(los), null, "mesh owned by a damageable thing must not block after the check");
});

test("a frozen mesh whose world matrix is unfrozen and moved into the ray is seen", (t) => {
  const { scene, los, dispose } = setup();
  t.after(dispose);
  const box = wall(scene, "unfrozen", true);
  box.position.x = OFF_RAY_X;
  box.computeWorldMatrix(true);
  box.freezeWorldMatrix();
  assert.equal(ray(los), null, "frozen mesh beside the ray does not block");
  box.unfreezeWorldMatrix();
  box.position.x = 0;
  // In the game the render loop recomputes the matrix; a NullEngine scene without frames has to force it.
  box.computeWorldMatrix(true);
  steps(los, STEPS_PAST_CHECK);
  assert.notEqual(ray(los), null, "unfrozen mesh moved into the ray must block after the check");
});
