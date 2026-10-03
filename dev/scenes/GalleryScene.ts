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
import { ModelRegistry, type ModelEntry, type ModelOptions } from "../../src/utils/ModelRegistry";
import { GalleryData, type GallerySectionData } from "../GalleryData";
import { GalleryLabels } from "../GalleryLabels";

// Every model class registers itself when its module loads; load them all (new model files are picked up automatically).
import.meta.glob("../../src/**/models/*Model.ts", { eager: true });

const DEG_TO_RAD = Math.PI / 180;
const HALF = 0.5;
const MODEL_SUFFIX = "Model";
const SECTION_PARAM = "section";
/** Room left of a row for its section title, in cell widths. */
const TITLE_CELLS = 1.6;
/** Height of a section title above its row (m). */
const TITLE_RISE = 0.5;
const OTHER_SECTION_ID = "other";
const SCALE_DECIMALS = 2;

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
  const sections = buildSections(data.sections, data.otherTitle);
  const rows = layoutRows(sections, data);
  const labels = new GalleryLabels(scene);
  game.addAmbientLight();

  const floorWidth = data.columns * data.cell.width + 2 * TITLE_CELLS * data.cell.width;
  const floorDepth = rows.length * data.cell.depth;
  const floor = MeshBuilder.CreateGround("gallery-floor", { width: floorWidth * 2, height: floorDepth * 2 }, scene);
  floor.position.z = floorDepth * HALF - data.cell.depth * HALF;
  floor.material = FlatMaterials.get(scene, data.floorColor);

  const items: GalleryItemInfo[] = [];
  for (const [r, row] of rows.entries()) {
    const rowMeshes: AbstractMesh[] = [];
    if (row.y > 0) {
      const tier = MeshBuilder.CreateBox(`gallery-tier-${r}`, { width: row.width + data.cell.width, height: row.y, depth: data.cell.depth }, scene);
      tier.position.set(0, row.y * HALF, row.z);
      tier.material = FlatMaterials.get(scene, data.floorColor);
      rowMeshes.push(tier);
    }
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
      root.rotation.y = (data.yawDeg[item.entry.category] ?? data.yawDeg.default) * DEG_TO_RAD;
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
      const scaleText = Math.abs(fit - 1) < 10 ** -SCALE_DECIMALS ? "" : ` ×${fit.toFixed(SCALE_DECIMALS)}`;
      labels.addModel(new Vector3(x, top - data.labelDrop, row.z - pedestal.size * HALF), `${item.label}${scaleText}`, triangles, budget);
      items.push({ name: item.entry.name, label: item.label, section: row.section.id, category: item.entry.category, triangles, budget, scale: fit });
    });
    if (row.first) labels.addTitle(new Vector3(-(row.width * HALF) - TITLE_CELLS * HALF * data.cell.width, row.y + TITLE_RISE, row.z), row.section.title);
    addRowLights(game, row, rowMeshes, data, r);
  }

  const focus = new URLSearchParams(window.location.search).get(SECTION_PARAM);
  const framed = rows.filter((row) => focus === null || row.section.id === focus);
  frameCamera(game, framed.length > 0 ? framed : rows, data, focus !== null && framed.length > 0);

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
  const shortName = (entry: ModelEntry): string => entry.name.replace(new RegExp(`${MODEL_SUFFIX}$`), "");
  const sections: Section[] = sectionData.map((section) => {
    const items: Item[] = section.items.map((item) => {
      const entry = resolve(item.model, `section ${section.id}`);
      return { entry, label: item.label === undefined ? shortName(entry) : `${shortName(entry)} · ${item.label}`, options: item.options };
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

/** Sections cut into rows of at most `columns` items; each row one cell deeper and `rowRise` higher than the last. */
function layoutRows(sections: readonly Section[], data: GalleryData): Row[] {
  const rows: Row[] = [];
  for (const section of sections) {
    for (let start = 0; start < section.items.length; start += data.columns) {
      const items = section.items.slice(start, start + data.columns);
      const r = rows.length;
      rows.push({ section, first: start === 0, items, y: r * data.rowRise, z: r * data.cell.depth, width: items.length * data.cell.width });
    }
  }
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

/** Points the camera from the front and above at the rows so that all of them fit the view. */
function frameCamera(game: Game, rows: readonly Row[], data: GalleryData, focused: boolean): void {
  const camera = game.createDefaultCamera(true);
  camera.fov = data.camera.fov;
  game.useCamera(camera);
  const margin = focused ? data.camera.focusMargin : data.camera.margin;
  const width = Math.max(...rows.map((r) => r.width)) + 2 * TITLE_CELLS * data.cell.width;
  const z0 = rows[0]!.z - data.cell.depth * HALF;
  const z1 = rows[rows.length - 1]!.z + data.cell.depth * HALF;
  const y0 = rows[0]!.y;
  const y1 = rows[rows.length - 1]!.y + data.pedestal.height + data.cell.maxHeight;
  const target = new Vector3(0, (y0 + y1) * HALF, (z0 + z1) * HALF);
  const pitch = data.camera.pitchDeg * DEG_TO_RAD;
  const aspect = game.engine.getAspectRatio(camera);
  const halfV = Math.tan(data.camera.fov * HALF);
  const halfH = halfV * aspect;
  // Extent across the view: the slab of rows seen from above at `pitch`.
  const across = (z1 - z0) * Math.sin(pitch) + (y1 - y0) * Math.cos(pitch);
  const distance = Math.max((width * HALF) / halfH, (across * HALF) / halfV) * margin + (z1 - z0) * HALF * Math.cos(pitch);
  const back = new Vector3(0, Math.sin(pitch), -Math.cos(pitch)).scale(distance);
  camera.position = target.add(back);
  camera.setTarget(target);
}

/** One entry per registered model: its most expensive gallery variant against its budget. */
function budgetList(items: readonly GalleryItemInfo[]): ModelBudgetInfo[] {
  return ModelRegistry.list().map((entry) => {
    const shown = items.filter((i) => i.name === entry.name);
    const triangles = Math.max(0, ...shown.map((i) => i.triangles));
    return { name: entry.name, category: entry.category, title: entry.title, triangles, budget: ModelRegistry.budget(entry.category) };
  });
}
