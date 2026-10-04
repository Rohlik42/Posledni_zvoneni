import { Observable } from "@babylonjs/core/Misc/observable";
import { CHEAT_IDS, type CheatId, type CheatsData } from "./InputBindings";
import { TestHooks } from "./TestHooks";

export interface CheatEvent {
  id: CheatId;
  /** For the toggles (`god`, `noclip`) the new state; `arsenal` is always true. */
  enabled: boolean;
}

/** `window.__game.cheats` (FEEDBACK 2026-10-04). */
export interface CheatsTestApi {
  readonly god: boolean;
  readonly noclip: boolean;
  /** The codes from data/input.json → cheats.codes. */
  codes: () => Record<CheatId, string>;
  /** Runs a cheat as if its code was typed; returns the new state. */
  activate: (id: CheatId) => boolean;
  /** How many cheats were activated (typed or through `activate`). */
  readonly count: number;
}

declare module "./TestHooks" {
  interface GameTestModules {
    cheats: CheatsTestApi;
  }
}

/** Cheats that stay on until typed again. */
const TOGGLES: ReadonlySet<CheatId> = new Set<CheatId>(["god", "noclip"]);

/**
 * The Doom cheats of one game (FEEDBACK 2026-10-04): which toggles are on and an `onCheat` event per activation. The
 * systems do the work themselves — `Player` (god mode, noclip), `WeaponInventory` and `Inventory` (IDKFA), `Hud`
 * (toast, badges) — so a cheat works in every scene that has them. `Input` matches the typed codes (`CheatCodes`).
 */
export class Cheats {
  readonly onCheat = new Observable<CheatEvent>();
  private readonly on = new Set<CheatId>();
  private activations = 0;

  constructor(readonly data: CheatsData) {
    const cheats = this;
    TestHooks.register("cheats", {
      get god() {
        return cheats.isOn("god");
      },
      get noclip() {
        return cheats.isOn("noclip");
      },
      codes: () => ({ ...data.codes }),
      activate: (id) => {
        if (!(CHEAT_IDS as readonly string[]).includes(id)) throw new Error(`unknown cheat ${id}`);
        return cheats.activate(id);
      },
      get count() {
        return cheats.activations;
      },
    });
  }

  isOn(id: CheatId): boolean {
    return this.on.has(id);
  }

  /** Flips a toggle or runs a one-shot cheat; returns the new state (true for one-shots). */
  activate(id: CheatId): boolean {
    let enabled = true;
    if (TOGGLES.has(id)) {
      enabled = !this.on.has(id);
      if (enabled) this.on.add(id);
      else this.on.delete(id);
    }
    this.activations++;
    this.onCheat.notifyObservers({ id, enabled });
    return enabled;
  }
}
