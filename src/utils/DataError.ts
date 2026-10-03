/** Thrown when a `data/*.json` file does not match its schema. The message names the file and the field path. */
export class DataError extends Error {
  constructor(
    readonly file: string,
    readonly path: string,
    readonly problem: string,
  ) {
    super(`${file}: ${path === "" ? "(root)" : path} ${problem}`);
    this.name = "DataError";
  }
}
