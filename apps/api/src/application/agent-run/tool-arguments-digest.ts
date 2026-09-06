import { createHash } from "node:crypto";
/** JSON structural canonicalization: recursively sorted object keys, array order
 * preserved, JSON number/string encoding. The internal API accepts raw toolArgs so
 * Python never has to duplicate this algorithm. No raw argument content is stored. */
export function toolArgumentsDigest(value: unknown): string | null {
  function canonical(input: unknown, depth: number): string {
    if (depth > 64) throw new Error("arguments_too_deep");
    if (input === null || typeof input === "string" || typeof input === "boolean") return JSON.stringify(input);
    if (typeof input === "number" && Number.isFinite(input)) return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(item => canonical(item, depth + 1)).join(",")}]`;
    if (typeof input === "object" && input !== null && Object.getPrototypeOf(input) === Object.prototype) {
      return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${canonical((input as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
    }
    throw new Error("invalid_json_arguments");
  }
  try { return createHash("sha256").update(canonical(value, 0)).digest("hex"); }
  catch { return null; }
}
