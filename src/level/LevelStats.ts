/** What a checkpoint keeps of the statistics (time and deaths run on regardless). */
export interface StatsSnapshot {
  kills: number;
  right: number;
  wrong: number;
}

/**
 * Numbers for the level-end screen (phase 16): play time in simulated seconds (pauses, the quiz and the story screens
 * do not count), robots destroyed, right and wrong quiz answers, returns to a checkpoint. A checkpoint restore puts
 * kills and answers back to the saved values (the robots come back too); time and deaths keep counting.
 */
export class LevelStats {
  private seconds = 0;
  private killCount = 0;
  private rightCount = 0;
  private wrongCount = 0;
  private deathCount = 0;

  get timeSeconds(): number {
    return this.seconds;
  }

  get kills(): number {
    return this.killCount;
  }

  get right(): number {
    return this.rightCount;
  }

  get wrong(): number {
    return this.wrongCount;
  }

  get deaths(): number {
    return this.deathCount;
  }

  tick(dt: number): void {
    this.seconds += dt;
  }

  kill(): void {
    this.killCount++;
  }

  answer(correct: boolean): void {
    if (correct) this.rightCount++;
    else this.wrongCount++;
  }

  died(): void {
    this.deathCount++;
  }

  snapshot(): StatsSnapshot {
    return { kills: this.killCount, right: this.rightCount, wrong: this.wrongCount };
  }

  restore(snapshot: StatsSnapshot): void {
    this.killCount = snapshot.kills;
    this.rightCount = snapshot.right;
    this.wrongCount = snapshot.wrong;
  }

  /** Starts over with a saved time (a game continued from the menu keeps its clock). */
  resume(snapshot: StatsSnapshot, seconds: number, deaths: number): void {
    this.restore(snapshot);
    this.seconds = seconds;
    this.deathCount = deaths;
  }
}
