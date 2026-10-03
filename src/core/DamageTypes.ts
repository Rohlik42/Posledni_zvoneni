/**
 * Damage categories shared by the player, weapons and enemies. Water and electricity hurt robots more (DESIGN §4);
 * `explosion` is the quiz trap and robot deaths, `quiz` a wrong answer.
 */
export const DAMAGE_TYPES = ["water", "electric", "kinetic", "explosion", "quiz"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
