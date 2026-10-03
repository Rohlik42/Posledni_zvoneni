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
  "door",
  "weapon1",
  "weapon2",
  "weapon3",
  "weapon4",
  "weapon5",
  "weapon6",
  "weaponNext",
  "weaponPrev",
  "pause",
  "mute",
] as const;

export type InputAction = (typeof INPUT_ACTIONS)[number];

export const MOUSE_BUTTONS = ["0", "1", "2", "3", "4"] as const;

export interface InputBindingsData {
  keys: Record<string, InputAction>;
  mouseButtons: Partial<Record<(typeof MOUSE_BUTTONS)[number], InputAction>>;
  wheel: { up: InputAction; down: InputAction; cooldownMs: number };
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
    pointerLock: Schema.object({ lockOnClick: Schema.boolean(), fallbackMessage: Schema.string() }),
  });

  static load(): InputBindingsData {
    return DataLoader.parse<InputBindingsData>(InputBindings.file, inputJson, InputBindings.schema);
  }
}
