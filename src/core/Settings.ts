import { Observable } from "@babylonjs/core/Misc/observable";
import { MenuConfig, QUALITY_OPTIONS, type QualityOption, type RangeSetting, type SettingsData } from "../ui/MenuConfig";

/** The player's settings (phase 18). JSON-safe. */
export interface SettingsValues {
  /** Multiplier of `player.json → camera.mouseSensitivity`. */
  mouseSensitivity: number;
  /** Master volume 0–1 (multiplies `sounds.json → masterVolume`). */
  volume: number;
  /** Music volume 0–1 (multiplies `audio.json → buses.music`, phase 20). */
  musicVolume: number;
  /** Effects volume 0–1 (multiplies `audio.json → buses.effects` and `buses.world`, phase 20). */
  effectsVolume: number;
  invertY: boolean;
  /** glTF teachers instead of the primitive ones from the next level on (FEEDBACK 2026-10-04, `TeacherModelFactory`). */
  realisticPeople: boolean;
  /** Quality preset (phase 21 applies it). */
  quality: QualityOption;
}

interface StoredSettings extends SettingsValues {
  version: number;
}

/**
 * Mouse sensitivity, volumes (master, music, effects), invert Y, realistic people and the quality preset, kept in `localStorage` (key and ranges from
 * data/menu.json → settings). One shared instance per page: the player camera and the sounds read it when they are
 * created and follow `onChanged`, so the settings apply in every scene, not only behind the menu. Unreadable or blocked
 * storage gives the defaults; values out of range are clamped.
 */
export class Settings {
  private static instance: Settings | null = null;

  readonly onChanged = new Observable<SettingsValues>();
  private current: SettingsValues;

  private constructor(private readonly data: SettingsData) {
    this.current = this.read();
  }

  static shared(): Settings {
    Settings.instance ??= new Settings(MenuConfig.load().settings);
    return Settings.instance;
  }

  get values(): SettingsValues {
    return { ...this.current };
  }

  get defaults(): SettingsValues {
    const d = this.data;
    return {
      mouseSensitivity: d.mouseSensitivity.default,
      volume: d.volume.default,
      musicVolume: d.musicVolume.default,
      effectsVolume: d.effectsVolume.default,
      invertY: d.invertY,
      realisticPeople: d.realisticPeople,
      quality: d.quality,
    };
  }

  /** Changes some values, stores them and notifies; returns the values after clamping. */
  set(change: Partial<SettingsValues>): SettingsValues {
    this.current = this.sanitize({ ...this.current, ...change });
    try {
      const stored: StoredSettings = { version: this.data.version, ...this.current };
      window.localStorage.setItem(this.data.storageKey, JSON.stringify(stored));
    } catch {
      // Storage blocked: the values still apply for this page.
    }
    this.onChanged.notifyObservers(this.values);
    return this.values;
  }

  /** Back to the defaults of data/menu.json. */
  reset(): SettingsValues {
    return this.set(this.defaults);
  }

  /** Re-reads the stored values (another tab may have changed them). */
  reload(): SettingsValues {
    this.current = this.read();
    this.onChanged.notifyObservers(this.values);
    return this.values;
  }

  private read(): SettingsValues {
    try {
      const raw = window.localStorage.getItem(this.data.storageKey);
      if (raw === null) return this.defaults;
      const parsed = JSON.parse(raw) as Partial<StoredSettings>;
      if (parsed.version !== this.data.version) return this.defaults;
      return this.sanitize({ ...this.defaults, ...parsed });
    } catch {
      return this.defaults;
    }
  }

  private sanitize(values: SettingsValues): SettingsValues {
    const d = this.defaults;
    return {
      mouseSensitivity: Settings.clamp(values.mouseSensitivity, this.data.mouseSensitivity),
      volume: Settings.clamp(values.volume, this.data.volume),
      musicVolume: Settings.clamp(values.musicVolume, this.data.musicVolume),
      effectsVolume: Settings.clamp(values.effectsVolume, this.data.effectsVolume),
      invertY: typeof values.invertY === "boolean" ? values.invertY : d.invertY,
      realisticPeople: typeof values.realisticPeople === "boolean" ? values.realisticPeople : d.realisticPeople,
      quality: (QUALITY_OPTIONS as readonly string[]).includes(values.quality) ? values.quality : d.quality,
    };
  }

  private static clamp(value: unknown, range: RangeSetting): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return range.default;
    return Math.min(range.max, Math.max(range.min, value));
  }
}
