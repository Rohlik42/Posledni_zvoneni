import type { PickupsSnapshot } from "../level/PickupField";
import type { StatsSnapshot } from "../level/LevelStats";
import type { InventorySnapshot } from "../player/Inventory";
import type { WeaponsSnapshot } from "../weapons/WeaponInventory";

/** Everything a checkpoint keeps (DECISIONS #8: a checkpoint after each key, not a full save). JSON-safe. */
export interface CheckpointState {
  version: number;
  /** Why it was saved: `start` or the key colour (`red`, `yellow`, `blue`). */
  label: string;
  /** Difficulty id of the run (phase 17); missing in checkpoints saved before it (= the default level). */
  difficulty?: string;
  player: { position: [number, number, number]; yaw: number; health: number };
  inventory: InventorySnapshot;
  weapons: WeaponsSnapshot;
  /** Freed teachers. */
  teachers: string[];
  /** Open doors. */
  doors: string[];
  /** Destroyed robots. */
  enemies: string[];
  pickups: PickupsSnapshot;
  /** Charges left per wall extinguisher. */
  stations: Record<string, number>;
  stats: StatsSnapshot & { timeSeconds: number; deaths: number };
}

/**
 * The checkpoint store (phase 16): one `CheckpointState` in `localStorage` under a key from data/progression.json.
 * A state of another version, unreadable JSON or a blocked storage reads as „no checkpoint“; the last saved state is
 * also kept in memory, so dying works even where storage is unavailable.
 */
export class Checkpoint {
  private latest: CheckpointState | null = null;

  constructor(
    private readonly storageKey: string,
    private readonly version: number,
  ) {}

  /** The state saved last in this session, else the stored one. */
  get current(): CheckpointState | null {
    return this.latest ?? this.load();
  }

  /** Saves `state` (also in memory); false when the storage refused it. */
  save(state: CheckpointState): boolean {
    this.latest = state;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  /** The stored checkpoint, or null when there is none of this version. */
  load(): CheckpointState | null {
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (raw === null) return null;
      const state = JSON.parse(raw) as Partial<CheckpointState>;
      return state.version === this.version ? (state as CheckpointState) : null;
    } catch {
      return null;
    }
  }

  /** Whether a stored checkpoint exists (the menu's „Pokračovat“, phase 18). */
  exists(): boolean {
    return this.load() !== null;
  }

  clear(): void {
    this.latest = null;
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {
      // Storage blocked: nothing stored either.
    }
  }
}
