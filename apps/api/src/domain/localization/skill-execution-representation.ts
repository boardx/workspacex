import { wave2Runtime } from "@repo/contracts";
import { sha256, skillContentDigest, type SkillStarterPack } from "../skill/starter-pack";
type Definition = Pick<SkillStarterPack["skills"][number], "manifest" | "files">;

/** Recover syntax only from a proven hash preimage. Never invent an ordering or
 * change a legacy execution coordinate just to make an export succeed. */
export function restoreSkillExecution(input: Definition & { representation: string | null; contentDigest: string }): Definition | null {
  let definition: Definition = { manifest: input.manifest,files: input.files };
  if (input.representation !== null) {
    if (sha256(input.representation) !== input.contentDigest) return null;
    let raw: unknown;
    try { raw = JSON.parse(input.representation); } catch { return null; }
    const parsed = wave2Runtime.SkillExecutionRepresentation.safeParse(raw);
    if (!parsed.success || parsed.data.files.length !== input.files.length) return null;
    const byPath = new Map(input.files.map(file => [file.path,file]));
    const files: Definition["files"] = [];
    if (new Set(parsed.data.files.map(file => file.path)).size !== input.files.length) return null;
    for (const expected of parsed.data.files) {
      const file = byPath.get(expected.path);
      if (!file || file.digest !== expected.digest || file.mediaType !== expected.mediaType) return null;
      files.push(file);
    }
    definition = { manifest: parsed.data.manifest,files };
  }
  if (definition.files.some(file => sha256(Buffer.from(file.contentBase64,"base64")) !== file.digest)) return null;
  return skillContentDigest(definition) === input.contentDigest ? definition : null;
}
