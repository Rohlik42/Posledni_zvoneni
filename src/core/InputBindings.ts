import inputJson from "../../data/input.json";
import { DataLoader } from "../utils/DataLoader";
import { Schema } from "../utils/Schema";

/** Every action the game reacts to. Bindings to physical keys and buttons live in `data/input.json`. */
export const INPUT_ACTIONS = [
  "forward",
  "back",
  "left",
  "right",
  "sprint",
  "jump",
  "interact",
  "fire",
  "altFire",
  "reload",
  "door",
  "weapon1",
  "weapon2",
  "weapon3",
  "weapon4",
  "weapon5",
  "weapon6",
  "weaponNext",
  "weaponPrev",
  "lookLeft",
  "lookRight",
  "lookUp",
  "lookDown",
  "lockPointer",
  "descend",
  "pause",
  "mute",
  "debugNavmesh",
] as const;

export type InputAction = (typeof INPUT_ACTIONS)[number];

/** Doom cheats (FEEDBACK 2026-10-04): `god` and `noclip` toggle, `arsenal` gives everything once. */
export const CHEAT_IDS = ["god", "arsenal", "noclip"] as const;

export type CheatId = (typeof CHEAT_IDS)[number];

export interface CheatsData {
  /** The letters to type per cheat (A–Z). */
  codes: Record<CheatId, string>;
  /** Longest pause between two letters of a code (ms of real time). */
  timeoutMs: number;
  /** Flying speeds in noclip (m/s). */
  noclip: { speed: number; verticalSpeed: number };
}

export const MOUSE_BUTTONS = ["0", "1", "2", "3", "4"] as const;

export interface InputBindingsData {
  keys: Record<string, InputAction>;
  mouseButtons: Partial<Record<(typeof MOUSE_BUTTONS)[number], InputAction>>;
  wheel: { up: InputAction; down: InputAction; cooldownMs: number };
  /** Turn rates of the look keys (`lookLeft` …) in rad/s, before the menu's sensitivity multiplier. */
  keyLook: { yawSpeed: number; pitchSpeed: number };
  cheats: CheatsData;
  pointerLock: { lockOnClick: boolean; fallbackMessage: string };
}

/** Typed loader for `data/input.json`. */
export class InputBindings {
  static readonly file = "data/input.json";

  static readonly schema = Schema.object({
    keys: Schema.record(Schema.enumOf(INPUT_ACTIONS), Schema.string()),
    mouseButtons: Schema.record(Schema.enumOf(INPUT_ACTIONS), Schema.enumOf(MOUSE_BUTTONS)),
    wheel: Schema.object({
      up: Schema.enumOf(INPUT_ACTIONS),
      down: Schema.enumOf(INPUT_ACTIONS),
      cooldownMs: Schema.number({ min: 0 }),
    }),
    keyLook: Schema.object({ yawSpeed: Schema.number({ min: 0 }), pitchSpeed: Schema.number({ min: 0 }) }),
    cheats: Schema.object({
      codes: Schema.object({ god: Schema.string(), arsenal: Schema.string(), noclip: Schema.string() }),
      timeoutMs: Schema.number({ min: 1 }),
      noclip: Schema.object({ speed: Schema.number({ min: 0 }), verticalSpeed: Schema.number({ min: 0 }) }),
    }),
    pointerLock: Schema.object({ lockOnClick: Schema.boolean(), fallbackMessage: Schema.string() }),
  });

  static load(): InputBindingsData {
    return DataLoader.parse<InputBindingsData>(InputBindings.file, inputJson, InputBindings.schema);
  }
}
