/** Environment variable that lets a test overwrite the versioned screenshot in `screenshots/`. */
const SAVE_ENV = "SAVE_SCREENSHOTS";
const VERSIONED_DIR = "screenshots";
/** Gitignored output of Playwright (playwright.config.ts → outputDir). */
const TEST_OUTPUT_DIR = "test-results/screenshots";

/**
 * Where a test saves a screenshot. Test runs are not deterministic (the playthrough's time differs between runs), so by
 * default shots go to the gitignored `test-results/` and a full run never dirties the repository; `SAVE_SCREENSHOTS=1`
 * writes the versioned `screenshots/<name>` on purpose (a phase refreshing its evidence).
 */
export class ShotPath {
  static of(name: string): string {
    const dir = process.env[SAVE_ENV] === "1" ? VERSIONED_DIR : TEST_OUTPUT_DIR;
    return `${dir}/${name}`;
  }
}
