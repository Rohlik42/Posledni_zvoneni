import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { Game } from "./Game";

export const NOISE_KINDS = ["gunshot", "impact", "explosion"] as const;
export type NoiseKind = (typeof NOISE_KINDS)[number];

/** A sound enemies can hear: where, what, and how loud relative to a gunshot (1 = heard over the full hearing range). */
export interface NoiseEvent {
  position: Vector3;
  kind: NoiseKind;
  loudness: number;
  /** Simulated time of the noise in milliseconds. */
  timeMs: number;
}

/**
 * Gameplay noise for AI hearing (not audio): the player's weapons report their shots here and robots within their
 * hearing range react. One instance per game (`NoiseEvents.for(game)`), so emitters and listeners never import each
 * other.
 */
export class NoiseEvents {
  private static readonly instances = new WeakMap<Game, NoiseEvents>();

  readonly onNoise = new Observable<NoiseEvent>();

  private constructor(private readonly game: Game) {}

  static for(game: Game): NoiseEvents {
    let events = NoiseEvents.instances.get(game);
    if (events === undefined) {
      events = new NoiseEvents(game);
      NoiseEvents.instances.set(game, events);
    }
    return events;
  }

  emit(position: Vector3, kind: NoiseKind, loudness = 1): void {
    this.onNoise.notifyObservers({ position: position.clone(), kind, loudness, timeMs: this.game.simulatedTimeMs });
  }
}
