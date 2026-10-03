/** One row of the ASSETS.md table. */
export interface AssetCredit {
  file: string;
  source: string;
  license: string;
}

const TABLE_COLUMNS = 3;
const SEPARATOR_ROW = /^\|\s*:?-{3,}/;
const CODE_TICKS = /`/g;

/**
 * The credits screen's list (DECISIONS #7: a „Zdroje“ screen with the content of ASSETS.md instead of CC-BY credits):
 * parses the markdown table of ASSETS.md (`| file | source | license |`), skips the header and separator rows and drops
 * the code ticks. Pure, so the data test checks it against the real file.
 */
export class AssetCredits {
  static parse(markdown: string): AssetCredit[] {
    const rows: AssetCredit[] = [];
    let header = true;
    for (const raw of markdown.split("\n")) {
      const line = raw.trim();
      if (!line.startsWith("|")) {
        header = true;
        continue;
      }
      if (SEPARATOR_ROW.test(line)) {
        header = false;
        continue;
      }
      if (header) continue;
      const cells = AssetCredits.cells(line);
      if (cells.length < TABLE_COLUMNS) continue;
      rows.push({ file: cells[0]!, source: cells[1]!, license: cells.slice(2).join(" | ") });
    }
    return rows;
  }

  /** Cells of a table row; a `|` inside a code span stays in its cell (`prague_{px,…}`). */
  private static cells(line: string): string[] {
    const cells: string[] = [];
    let current = "";
    let inCode = false;
    for (const ch of line.slice(1, line.endsWith("|") ? -1 : undefined)) {
      if (ch === "`") inCode = !inCode;
      if (ch === "|" && !inCode) {
        cells.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current);
    return cells.map((c) => c.replace(CODE_TICKS, "").trim());
  }
}
