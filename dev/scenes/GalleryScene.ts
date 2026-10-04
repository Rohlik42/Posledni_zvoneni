import type { Light } from "@babylonjs/core/Lights/light";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Game } from "../../src/core/Game";
import { TestHooks } from "../../src/core/TestHooks";
import { TeacherConfig } from "../../src/level/TeacherConfig";
import { FlatMaterials } from "../../src/rendering/FlatMaterials";
import type { ModelCategory } from "../../src/rendering/ModelBlueprints";
import { PaletteColor } from "../../src/rendering/PaletteColor";
import { RenderingConfig } from "../../src/rendering/RenderingConfig";
import { ModelRegistry, type ModelEntry, type ModelOptions } from "../../src/utils/ModelRegistry";
import { GalleryData, type GallerySectionData } from "../GalleryData";
import { GalleryLabels } from "../GalleryLabels";

// Every model class registers itself when its module loads; load them all (new model files are picked up automatically).
import.meta.glob("../../src/**/models/*Model.ts", { eager: true });

const DEG_TO_RAD = Math.PI / 180;
const HALF = 0.5;
/** Dropped from class names in labels ("HumanoidRobotModel" → "Humanoid"). */
const NAME_SUFFIX = /(Robot)?Model$/;
const SECTION_PARAM = "section";
/** Room left of a row for its section title, in cell widths. */
const TITLE_CELLS = 1.6;
/** Height of a section title above its row (m). */
const TITLE_RISE = 0.5;
const OTHER_SECTION_ID = "other";
const SCALE_DECIMALS = 2;
const SHELF_THICKNESS = 0.06;
const WALL_THICKNESS = 0.1;
/** The back wall reaches past the shelves so the frame never shows its edge. */
const WALL_OVERSIZE = 3;

export const id = "gallery";
export const title = "Galerie všech modelů z ModelRegistry na podstavcích s počtem trojúhelníků (?section=weapons|robots|teachers|pickups|props|fixtures zabere jednu sekci)";

export interface ModelBudgetInfo {
  name: string;
  category: ModelCategory;
  title: string;
  /** The most triangles any gallery variant of the model has. */
  triangles: number;
  budget: number;
}

export interface GalleryItemInfo {
  name: string;
  label: string;
  section: string;
  category: ModelCategory;
  triangles: number;
  budget: number;
  /** Display scale (models are fitted to their cell). */
  scale: number;
}

/** `window.__game.models` — every registered model with its triangle count and budget (model-budget smoke test). */
export interface ModelsTestApi {
  list: () => ModelBudgetInfo[];
}

/** `window.__game.gallery` — what the gallery shows. */
export interface GalleryTestApi {
  items: () => GalleryItemInfo[];
  sections: () => string[];
}

declare module "../../src/core/TestHooks" {
  interface GameTestModules {
    models: ModelsTestApi;
    gallery: GalleryTestApi;
  }
}

interface Item {
  entry: ModelEntry;
  label: string;
  options?: ModelOptions;
  yawDeg?: number;
}

interface Section {
  id: string;
  title: string;
  maxScale: number;
  items: Item[];
}

interface Row {
  section: Section;
  first: boolean;
  items: Item[];
  y: number;
  z: number;
  width: number;
}

export function create(game: Game): void {
  const { scene } = game;
  const data = GalleryData.load();
  const all = buildSections(data.sections, data.otherTitle);
  const focus = new URLSearchParams(window.location.search).get(SECTION_PARAM);
  const focused = all.find((section) => section.id === focus) ?? null;
  // ?section=<id> shows just that section in fewer columns, so the camera comes closer.
  const sections = focused === null ? all : [focused];
  const rows = layoutRows(sections, focused === null ? data.columns : data.camera.focusColumns, data.rowHeight, data.cell.width);
  const labels = new GalleryLabels(scene);
  game.addAmbientLight();

  const wallWidth = data.columns * data.cell.width + 2 * TITLE_CELLS * data.cell.width;
  const wallHeight = rows.length * data.rowHeight;
  const wall = MeshBuilder.CreateBox("gallery-wall", { width: wallWidth * WALL_OVERSIZE, height: wallHeight * WALL_OVERSIZE, depth: WALL_THICKNESS }, scene);
  wall.position.set(0, wallHeight * HALF - data.rowHeight * HALF, data.cell.depth * HALF + WALL_THICKNESS * HALF);
  wall.material = FlatMaterials.get(scene, data.wallColor);

  const items: GalleryItemInfo[] = [];
  for (const [r, row] of rows.entries()) {
    const rowMeshes: AbstractMesh[] = [wall];
    const shelf = MeshBuilder.CreateBox(`gallery-shelf-${r}`, { width: row.width + data.cell.width * HALF, height: SHELF_THICKNESS, depth: data.cell.depth }, scene);
    shelf.position.set(0, row.y - SHELF_THICKNESS * HALF, row.z);
    shelf.material = FlatMaterials.get(scene, data.shelfColor);
    rowMeshes.push(shelf);
    row.items.forEach((item, i) => {
      const x = (i - (row.items.length - 1) * HALF) * data.cell.width;
      const { pedestal } = data;
      const top = row.y + pedestal.height;
      const base = MeshBuilder.CreateBox(`gallery-pedestal-${r}-${i}`, { width: pedestal.size, height: pedestal.height, depth: pedestal.size }, scene);
      base.position.set(x, row.y + pedestal.height * HALF, row.z);
      base.material = FlatMaterials.get(scene, pedestal.color);
      rowMeshes.push(base);

      const instance = item.entry.create(scene, item.options);
      const triangles = ModelRegistry.countTriangles(instance.root);
      const root = instance.root;
      root.rotation.y = (item.yawDeg ?? data.yawDeg[item.entry.category] ?? data.yawDeg.default) * DEG_TO_RAD;
      root.computeWorldMatrix(true);
      const { min, max } = root.getHierarchyBoundingVectors(true);
      const size = max.subtract(min);
      const fit = Math.min(
        row.section.maxScale,
        data.cell.maxHeight / Math.max(size.y, Number.EPSILON),
        (data.cell.width * data.cell.fill) / Math.max(size.x, size.z, Number.EPSILON),
      );
      root.scaling.scaleInPlace(fit);
      root.position.set(x - ((min.x + max.x) * HALF) * fit, top - min.y * fit, row.z - ((min.z + max.z) * HALF) * fit);
      rowMeshes.push(...root.getChildMeshes(false));

      const budget = ModelRegistry.budget(item.entry.category);
      const scale = Math.abs(fit - 1) < 10 ** -SCALE_DECIMALS ? null : fit.toFixed(SCALE_DECIMALS);
      labels.addModel(new Vector3(x, top - data.labelDrop, row.z - pedestal.size * HALF), item.label, triangles, budget, scale, data.cell.width);
      items.push({ name: item.entry.name, label: item.label, section: row.section.id, category: item.entry.category, triangles, budget, scale: fit });
    });
    if (row.first) labels.addTitle(new Vector3(-(row.width * HALF), row.y + TITLE_RISE, row.z), row.section.title, TITLE_CELLS * data.cell.width);
    addRowLights(game, row, rowMeshes, data, r);
  }

  frameCamera(game, rows, data, focused !== null);

  TestHooks.register("models", { list: () => budgetList(items) });
  TestHooks.register("gallery", {
    items: () => items.map((item) => ({ ...item })),
    sections: () => sections.map((s) => s.id),
  });
}

/** Sections from data/gallery.json (teachers expanded from teachers.json) plus "other" for unlisted registered models. */
function buildSections(sectionData: readonly GallerySectionData[], otherTitle: string): Section[] {
  const resolve = (name: string, where: string): ModelEntry => {
    const entry = ModelRegistry.get(name);
    if (entry === undefined) throw new Error(`${GalleryData.file}: ${where} names "${name}", which is not a registered model`);
    return entry;
  };
  const shortName = (entry: ModelEntry): string => entry.name.replace(NAME_SUFFIX, "");
  const sections: Section[] = sectionData.map((section) => {
    const items: Item[] = section.items.map((item) => {
      const entry = resolve(item.model, `section ${section.id}`);
      return { entry, label: item.label === undefined ? shortName(entry) : `${shortName(entry)} · ${item.label}`, options: item.options, yawDeg: item.yawDeg };
    });
    if (section.teachers !== undefined) {
      const entry = resolve(section.teachers, `section ${section.id}.teachers`);
      for (const teacher of TeacherConfig.load().teachers) {
        const { variant, colors, features } = teacher.look;
        items.push({ entry, label: teacher.surname, options: { variant, colors, features } });
      }
    }
    return { id: section.id, title: section.title, maxScale: section.maxScale, items };
  });
  const shown = new Set(sections.flatMap((s) => s.items.map((i) => i.entry.name)));
  const others = ModelRegistry.list().filter((entry) => !shown.has(entry.name));
  if (others.length > 0) sections.push({ id: OTHER_SECTION_ID, title: otherTitle, maxScale: 1, items: others.map((entry) => ({ entry, label: shortName(entry) })) });
  return sections;
}

/** Sections cut into rows of at most `columns` items, one shelf per row stacked `rowHeight` apart. */
function layoutRows(sections: readonly Section[], columns: number, rowHeight: number, cellWidth: number): Row[] {
  const rows: Row[] = [];
  for (const section of sections) {
    for (let start = 0; start < section.items.length; start += columns) {
      const items = section.items.slice(start, start + columns);
      rows.push({ section, first: start === 0, items, y: 0, z: 0, width: items.length * cellWidth });
    }
  }
  // First section on the top shelf.
  rows.forEach((row, r) => (row.y = (rows.length - 1 - r) * rowHeight));
  return rows;
}

/** Fluorescent lamps over the front edge of a row, lighting only that row (like room lights in the level). */
function addRowLights(game: Game, row: Row, meshes: AbstractMesh[], data: GalleryData, r: number): void {
  const { lights } = data;
  const count = Math.max(1, Math.ceil(row.width / lights.spacing));
  const created: Light[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) * HALF) * (row.width / count);
    const light = new PointLight(`gallery-light-${r}-${i}`, new Vector3(x, row.y + lights.height, row.z + lights.forward), game.scene);
    light.diffuse = PaletteColor.color3(lights.color);
    light.specular = Color3.Black();
    light.intensity = lights.intensity;
    light.range = lights.range;
    light.includedOnlyMeshes = meshes;
    created.push(light);
  }
}

/** Points the camera at the shelves from the front so that all `rows` fit the view; shifts the game fog by the distance. */
function frameCamera(game: Game, rows: readonly Row[], data: GalleryData, focused: boolean): void {
  const camera = game.createDefaultCamera(true);
  camera.fov = data.camera.fov;
  game.useCamera(camera);
  const margin = focused ? data.camera.focusMargin : data.camera.margin;
  const width = Math.max(...rows.map((r) => r.width)) + 2 * TITLE_CELLS * data.cell.width;
  const y0 = Math.min(...rows.map((r) => r.y)) - data.camera.labelSpace;
  const y1 = Math.max(...rows.map((r) => r.y)) + data.pedestal.height + data.cell.maxHeight;
  const target = new Vector3(0, (y0 + y1) * HALF, 0);
  const pitch = data.camera.pitchDeg * DEG_TO_RAD;
  const halfV = Math.tan(data.camera.fov * HALF);
  const halfH = halfV * game.engine.getAspectRatio(camera);
  const distance = Math.max((width * HALF) / halfH, ((y1 - y0) * HALF) / halfV) * margin;
  camera.position = target.add(new Vector3(0, Math.sin(pitch), -Math.cos(pitch)).scale(distance));
  camera.setTarget(target);
  const { fog } = RenderingConfig.load();
  const shift = Math.max(0, distance - data.fogViewDistance);
  game.scene.fogStart = fog.start + shift;
  game.scene.fogEnd = fog.end + shift;
}

/** One entry per registered model: its most expensive gallery variant against its budget. */
function budgetList(items: readonly GalleryItemInfo[]): ModelBudgetInfo[] {
  return ModelRegistry.list().map((entry) => {
    const shown = items.filter((i) => i.name === entry.name);
    const triangles = Math.max(0, ...shown.map((i) => i.triangles));
    return { name: entry.name, category: entry.category, title: entry.title, triangles, budget: ModelRegistry.budget(entry.category) };
  });
}
