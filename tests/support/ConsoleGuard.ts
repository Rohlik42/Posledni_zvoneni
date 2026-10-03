import type { Page } from "@playwright/test";

/**
 * Library messages we cannot influence. DoD §15 wants no errors and no warnings, so every other `console.warn`,
 * `console.error` and uncaught page error fails the test. Keep this list short and say why each entry is here.
 */
const ALLOWED_WARNINGS: readonly RegExp[] = [];

/** Collects console errors, warnings and page errors from the moment it is attached. */
export class ConsoleGuard {
  readonly problems: string[] = [];

  constructor(page: Page) {
    page.on("console", (msg) => {
      const type = msg.type();
      if (type !== "error" && type !== "warning") return;
      const text = msg.text();
      if (ALLOWED_WARNINGS.some((pattern) => pattern.test(text))) return;
      this.problems.push(`console.${type}: ${text}`);
    });
    page.on("pageerror", (err) => this.problems.push(`pageerror: ${err.message}`));
  }
}
