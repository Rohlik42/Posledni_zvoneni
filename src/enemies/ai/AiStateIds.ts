/**
 * States of the robot AI (DESIGN §5: hlídkuje → slyší/vidí → pronásleduje → útočí → hledá → hlídkuje), plus taking
 * cover (humanoid), circling the player and lunging (quadruped), being stunned (`Enemy.applyStatus("stun")`) and dead.
 * Tests read them through `__game.enemies`.
 */
export const AI_STATE_IDS = ["patrol", "alert", "chase", "attack", "cover", "circle", "lunge", "search", "stunned", "dead"] as const;
export type AiStateId = (typeof AI_STATE_IDS)[number];
