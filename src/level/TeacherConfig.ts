import teachersJson from "../../data/teachers.json";
import { DAMAGE_TYPES, type DamageType } from "../core/DamageTypes";
import type { Vec3Tuple } from "../core/GameConfig";
import { DataLoader } from "../utils/DataLoader";
import { Schema, type SchemaNode } from "../utils/Schema";

export interface TeacherReward {
  /** Item id of `data/pickups.json`. */
  item: string;
  amount?: number;
}

export interface TeacherLook {
  /** Jacket variant of the `teacher` blueprint (LEGACY §1: roster index % 3). */
  variant: string;
  /** Colour slot → palette key on top of the variant (hair, tie…). */
  colors?: Record<string, string>;
  /** Names from `model.features` whose parts are shown (hair styles, glasses, moustache). */
  features: string[];
}

export interface TeacherData {
  id: string;
  /** Progression slot, `data/level.json → teachers[].slot`. */
  slot: number;
  surname: string;
  nickname?: string;
  /** Subject exactly as in LEGACY §1 and `data/quiz.json`. */
  subject: string;
  /** Room id of `data/level.json`. */
  room: string;
  rewards: TeacherReward[];
  look: TeacherLook;
  greeting: string;
  wrongLine: string;
  freedLine: string;
}

export interface TeacherPose {
  /** Offset of the `body` group from the blueprint's standing pose (m). */
  body: Vec3Tuple;
  /** Group → rotation in degrees [x, y, z]. */
  rotations: Record<string, Vec3Tuple>;
}

export interface TeacherModelData {
  features: Record<string, string[]>;
  shackleParts: string[];
  pose: { seated: TeacherPose; standing: TeacherPose };
  /** How strongly lights act on the model (BlueprintOptions.lightScale). */
  lightScale: number;
  standDelay: number;
  standTime: number;
  breath: { amplitude: number; period: number };
  head: { boundYawDeg: number; boundPitchDeg: number; freedYawDeg: number; freedPitchDeg: number; period: number };
  trapBlink: { period: number; onShare: number; alarmPeriod: number };
}

export interface NametagData {
  textureWidth: number;
  textureHeight: number;
  nameFont: string;
  subjectFont: string;
  nameY: number;
  subjectY: number;
  background: string;
  nameColor: string;
  subjectColor: string;
  width: number;
  height: number;
  aboveHead: number;
}

export interface TrapData {
  sparks: number;
  sparkSpeed: [number, number];
  sparkLife: [number, number];
  sparkSize: [number, number];
  spread: number;
  gravity: number;
  sparkColor: string;
  sparkGlow: number;
  flashColor: string;
  flashGlow: number;
  flashSize: number;
  flashTime: number;
  damageType: DamageType;
  shake: { amplitude: number; frequency: number; duration: number; vertical: number };
  sound: string;
}

export interface QuizUiData {
  fontFamily: string;
  textFamily: string;
  width: number;
  titleSize: number;
  subjectSize: number;
  lineSize: number;
  questionSize: number;
  optionSize: number;
  smallSize: number;
  blurPx: number;
  answerLockout: number;
  colors: Record<
    | "overlayTop"
    | "overlayBottom"
    | "panel"
    | "title"
    | "subject"
    | "text"
    | "dim"
    | "line"
    | "button"
    | "buttonText"
    | "buttonShadow"
    | "letter"
    | "wrong"
    | "correct",
    string
  >;
}

export interface TeachersData {
  teachers: TeacherData[];
  model: TeacherModelData;
  nametag: NametagData;
  interact: { range: number; nearRange: number; coneDeg: number };
  collider: { size: Vec3Tuple; center: Vec3Tuple };
  trap: TrapData;
  sounds: { open: string; correct: string; release: string };
  quizUi: QuizUiData;
}

const positive = (): SchemaNode => Schema.number({ min: 0 });
const range = (): SchemaNode => Schema.array(Schema.number({ min: 0 }), 2, 2);
const pose = (): SchemaNode => Schema.object({ body: Schema.vec3(), rotations: Schema.record(Schema.vec3()) });
const px = (): SchemaNode => Schema.number({ min: 1 });
const UI_COLORS = ["overlayTop", "overlayBottom", "panel", "title", "subject", "text", "dim", "line", "button", "buttonText", "buttonShadow", "letter", "wrong", "correct"];

/**
 * Typed loader for `data/teachers.json` (phase 11): the captive teachers (names, subjects and rooms from LEGACY §1 and
 * level.json, rewards, lines, look), the teacher model's poses and idle motion, the name tag, the trap explosion and
 * the quiz overlay layout.
 */
export class TeacherConfig {
  static readonly file = "data/teachers.json";

  static readonly schema = Schema.object({
    teachers: Schema.array(
      Schema.object(
        {
          id: Schema.string(),
          slot: Schema.integer({ min: 1 }),
          surname: Schema.string(),
          nickname: Schema.string(),
          subject: Schema.string(),
          room: Schema.string(),
          rewards: Schema.array(Schema.object({ item: Schema.string(), amount: Schema.integer({ min: 1 }) }, ["amount"]), 1),
          look: Schema.object(
            { variant: Schema.string(), colors: Schema.record(Schema.paletteRef()), features: Schema.array(Schema.string()) },
            ["colors"],
          ),
          greeting: Schema.string(),
          wrongLine: Schema.string(),
          freedLine: Schema.string(),
        },
        ["nickname"],
      ),
      1,
    ),
    model: Schema.object({
      features: Schema.record(Schema.array(Schema.string(), 1)),
      shackleParts: Schema.array(Schema.string(), 1),
      pose: Schema.object({ seated: pose(), standing: pose() }),
      lightScale: Schema.number({ min: 0.05, max: 2 }),
      standDelay: positive(),
      standTime: Schema.number({ min: 0.05 }),
      breath: Schema.object({ amplitude: positive(), period: Schema.number({ min: 0.1 }) }),
      head: Schema.object({
        boundYawDeg: positive(),
        boundPitchDeg: positive(),
        freedYawDeg: positive(),
        freedPitchDeg: positive(),
        period: Schema.number({ min: 0.1 }),
      }),
      trapBlink: Schema.object({
        period: Schema.number({ min: 0.02 }),
        onShare: Schema.number({ min: 0, max: 1 }),
        alarmPeriod: Schema.number({ min: 0.02 }),
      }),
    }),
    nametag: Schema.object({
      textureWidth: Schema.integer({ min: 16 }),
      textureHeight: Schema.integer({ min: 16 }),
      nameFont: Schema.string(),
      subjectFont: Schema.string(),
      nameY: positive(),
      subjectY: positive(),
      background: Schema.paletteRef(),
      nameColor: Schema.paletteRef(),
      subjectColor: Schema.paletteRef(),
      width: Schema.number({ min: 0.05 }),
      height: Schema.number({ min: 0.05 }),
      aboveHead: positive(),
    }),
    interact: Schema.object({ range: Schema.number({ min: 0.1 }), nearRange: positive(), coneDeg: Schema.number({ min: 0, max: 180 }) }),
    collider: Schema.object({ size: Schema.vec3(), center: Schema.vec3() }),
    trap: Schema.object({
      sparks: Schema.integer({ min: 0 }),
      sparkSpeed: range(),
      sparkLife: range(),
      sparkSize: range(),
      spread: positive(),
      gravity: positive(),
      sparkColor: Schema.paletteRef(),
      sparkGlow: positive(),
      flashColor: Schema.paletteRef(),
      flashGlow: positive(),
      flashSize: positive(),
      flashTime: positive(),
      damageType: Schema.enumOf(DAMAGE_TYPES),
      shake: Schema.object({ amplitude: positive(), frequency: positive(), duration: Schema.number({ min: 0.01 }), vertical: positive() }),
      sound: Schema.string(),
    }),
    sounds: Schema.object({ open: Schema.string(), correct: Schema.string(), release: Schema.string() }),
    quizUi: Schema.object({
      fontFamily: Schema.string(),
      textFamily: Schema.string(),
      width: px(),
      titleSize: px(),
      subjectSize: px(),
      lineSize: px(),
      questionSize: px(),
      optionSize: px(),
      smallSize: px(),
      blurPx: positive(),
      answerLockout: positive(),
      colors: Schema.object(Object.fromEntries(UI_COLORS.map((key) => [key, Schema.paletteRef()]))),
    }),
  });

  private static cached: TeachersData | null = null;

  static load(): TeachersData {
    if (TeacherConfig.cached === null) {
      const data = DataLoader.parse<TeachersData>(TeacherConfig.file, teachersJson, TeacherConfig.schema);
      TeacherConfig.validate(data);
      TeacherConfig.cached = data;
    }
    return TeacherConfig.cached;
  }

  /** The teacher `id`; throws for an unknown one. */
  static teacher(id: string): TeacherData {
    const teacher = TeacherConfig.load().teachers.find((t) => t.id === id);
    if (teacher === undefined) throw new Error(`${TeacherConfig.file}: no teacher "${id}"`);
    return teacher;
  }

  /** Every blueprint part some feature can show (hidden unless the teacher has that feature). */
  static optionalParts(model: TeacherModelData): string[] {
    return [...new Set(Object.entries(model.features).filter(([key]) => !key.startsWith("//")).flatMap(([, parts]) => parts))];
  }

  /** Cross-field checks the schema cannot express: unique ids and slots, known features. */
  private static validate(data: TeachersData): void {
    const ids = new Set<string>();
    const slots = new Set<number>();
    for (const teacher of data.teachers) {
      if (ids.has(teacher.id)) throw new Error(`${TeacherConfig.file}: duplicate teacher id "${teacher.id}"`);
      if (slots.has(teacher.slot)) throw new Error(`${TeacherConfig.file}: duplicate slot ${teacher.slot}`);
      ids.add(teacher.id);
      slots.add(teacher.slot);
      for (const feature of teacher.look.features) {
        if (data.model.features[feature] === undefined) throw new Error(`${TeacherConfig.file}: teacher ${teacher.id} has unknown feature "${feature}"`);
      }
    }
  }
}
