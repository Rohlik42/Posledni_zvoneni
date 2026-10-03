import { DataError } from "./DataError";
import type { SchemaNode } from "./Schema";

const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PALETTE_REF = /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/;
const COMMENT_PREFIX = "//";
const VEC3_LENGTH = 3;

/**
 * Typed access to `data/*.json`. Files are imported statically (`import raw from "../../data/x.json"`, bundled by Vite,
 * readable by tsx in Node tests) and passed through `DataLoader.parse`, which checks required fields, types and ranges
 * and throws a `DataError` naming the file and field. Each system owns its own typed loader next to its code.
 */
export class DataLoader {
  /** Validates `raw` against `schema` and returns it typed as `T`. Throws `DataError` on the first problem found. */
  static parse<T>(file: string, raw: unknown, schema: SchemaNode): T {
    DataLoader.check(file, "", raw, schema);
    return raw as T;
  }

  private static check(file: string, path: string, value: unknown, node: SchemaNode): void {
    const fail = (problem: string): never => {
      throw new DataError(file, path, problem);
    };
    const describe = (v: unknown): string => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

    switch (node.kind) {
      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value)) return fail(`must be a number (got ${describe(value)})`);
        if (node.integer === true && !Number.isInteger(value)) fail(`must be an integer (got ${value})`);
        if (node.min !== undefined && value < node.min) fail(`must be >= ${node.min} (got ${value})`);
        if (node.max !== undefined && value > node.max) fail(`must be <= ${node.max} (got ${value})`);
        return;
      }
      case "string":
        if (typeof value !== "string") return fail(`must be a string (got ${describe(value)})`);
        if (node.nonEmpty === true && value.length === 0) fail("must not be empty");
        return;
      case "boolean":
        if (typeof value !== "boolean") fail(`must be true or false (got ${describe(value)})`);
        return;
      case "color":
        if (typeof value !== "string" || !HEX_COLOR.test(value)) fail(`must be a #rrggbb or #rrggbbaa color (got ${JSON.stringify(value)})`);
        return;
      case "paletteRef":
        if (typeof value !== "string" || !PALETTE_REF.test(value)) fail(`must be a palette key "group.name" (got ${JSON.stringify(value)})`);
        return;
      case "enum":
        if (typeof value !== "string" || !node.values.includes(value)) {
          fail(`must be one of ${node.values.join(", ")} (got ${JSON.stringify(value)})`);
        }
        return;
      case "vec3":
        if (!Array.isArray(value) || value.length !== VEC3_LENGTH || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
          fail(`must be [x, y, z] numbers (got ${JSON.stringify(value)})`);
        }
        return;
      case "array": {
        if (!Array.isArray(value)) return fail(`must be an array (got ${describe(value)})`);
        if (node.min !== undefined && value.length < node.min) fail(`must have at least ${node.min} items (got ${value.length})`);
        if (node.max !== undefined && value.length > node.max) fail(`must have at most ${node.max} items (got ${value.length})`);
        value.forEach((item, i) => DataLoader.check(file, `${path}[${i}]`, item, node.of));
        return;
      }
      case "record": {
        const record = DataLoader.asObject(value, fail, describe);
        for (const [key, item] of Object.entries(record)) {
          if (key.startsWith(COMMENT_PREFIX)) continue;
          if (node.keys !== undefined) DataLoader.check(file, DataLoader.join(path, `<key ${key}>`), key, node.keys);
          DataLoader.check(file, DataLoader.join(path, key), item, node.of);
        }
        return;
      }
      case "object": {
        const object = DataLoader.asObject(value, fail, describe);
        const optional = node.optional ?? [];
        for (const [key, child] of Object.entries(node.fields)) {
          if (!(key in object)) {
            if (!optional.includes(key)) throw new DataError(file, DataLoader.join(path, key), "is required but missing");
            continue;
          }
          DataLoader.check(file, DataLoader.join(path, key), object[key], child);
        }
        for (const key of Object.keys(object)) {
          if (!key.startsWith(COMMENT_PREFIX) && !(key in node.fields)) {
            throw new DataError(file, DataLoader.join(path, key), `is not a known field (expected ${Object.keys(node.fields).join(", ")})`);
          }
        }
        return;
      }
    }
  }

  private static asObject(value: unknown, fail: (problem: string) => never, describe: (v: unknown) => string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(`must be an object (got ${describe(value)})`);
    return value as Record<string, unknown>;
  }

  private static join(path: string, key: string): string {
    return path === "" ? key : `${path}.${key}`;
  }
}
