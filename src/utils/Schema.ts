/** A tiny declarative schema for `data/*.json`. Built with the static helpers on `Schema`, checked by `DataLoader`. */
export type SchemaNode =
  | { kind: "number"; min?: number; max?: number; integer?: boolean }
  | { kind: "string"; nonEmpty?: boolean }
  | { kind: "boolean" }
  /** `#rrggbb` or `#rrggbbaa`. */
  | { kind: "color" }
  /** `group.name`, a key into `data/palette.json` (resolved by `Palette`). */
  | { kind: "paletteRef" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "vec3" }
  | { kind: "array"; of: SchemaNode; min?: number; max?: number }
  | { kind: "record"; of: SchemaNode; keys?: SchemaNode }
  | { kind: "object"; fields: Readonly<Record<string, SchemaNode>>; optional?: readonly string[] };

export interface NumberOptions {
  min?: number;
  max?: number;
}

/** Builders for `SchemaNode`. Keys that start with `//` are comments and are ignored by the validator. */
export class Schema {
  static number(options: NumberOptions = {}): SchemaNode {
    return { kind: "number", ...options };
  }

  static integer(options: NumberOptions = {}): SchemaNode {
    return { kind: "number", integer: true, ...options };
  }

  static string(): SchemaNode {
    return { kind: "string", nonEmpty: true };
  }

  static boolean(): SchemaNode {
    return { kind: "boolean" };
  }

  static color(): SchemaNode {
    return { kind: "color" };
  }

  static paletteRef(): SchemaNode {
    return { kind: "paletteRef" };
  }

  static enumOf(values: readonly string[]): SchemaNode {
    return { kind: "enum", values };
  }

  /** `[x, y, z]` in metres. */
  static vec3(): SchemaNode {
    return { kind: "vec3" };
  }

  static array(of: SchemaNode, min?: number, max?: number): SchemaNode {
    return { kind: "array", of, min, max };
  }

  static record(of: SchemaNode, keys?: SchemaNode): SchemaNode {
    return { kind: "record", of, keys };
  }

  static object(fields: Readonly<Record<string, SchemaNode>>, optional: readonly string[] = []): SchemaNode {
    return { kind: "object", fields, optional };
  }
}
