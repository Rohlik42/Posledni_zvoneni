import type { SchemaNode } from "../../src/utils/Schema";

/** Every string in `value` validated as a palette reference, found by walking the schema next to the data. */
export class PaletteRefs {
  static collect(value: unknown, node: SchemaNode, out: string[] = []): string[] {
    switch (node.kind) {
      case "paletteRef":
        out.push(value as string);
        break;
      case "array":
        (value as unknown[]).forEach((item) => PaletteRefs.collect(item, node.of, out));
        break;
      case "record":
        for (const [key, item] of Object.entries(value as object)) if (!key.startsWith("//")) PaletteRefs.collect(item, node.of, out);
        break;
      case "object":
        for (const [key, child] of Object.entries(node.fields)) {
          if (key in (value as object)) PaletteRefs.collect((value as Record<string, unknown>)[key], child, out);
        }
        break;
      default:
        break;
    }
    return out;
  }
}
