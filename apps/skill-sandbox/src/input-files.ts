/** Private sandbox wire contract, shared with the API adapter. */
export interface SandboxInputFile { readonly name: string; readonly contentBase64: string }
export const MAX_INPUT_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_INPUT_FILES = 256;

export function parseInputFiles(raw: unknown): readonly SandboxInputFile[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_INPUT_FILES) throw new Error("invalid sandbox input files");
  const names = new Set<string>();
  let total = 0;
  return raw.map((file: unknown) => {
    const entry = file as Partial<SandboxInputFile> | null;
    if (!entry || typeof entry.name !== "string" || (entry.name.length > 512 || !entry.name.split("/").every(segment => segment.length > 0 && segment !== "." && segment !== ".." && !/[\\:\u0000-\u001f\u007f]/.test(segment)))
      || typeof entry.contentBase64 !== "string" || [...names].some(name => name === entry.name || name.startsWith(`${entry.name}/`) || entry.name!.startsWith(`${name}/`))) throw new Error("invalid sandbox input file");
    const bytes = Buffer.from(entry.contentBase64, "base64");
    total += bytes.length;
    if (bytes.toString("base64") !== entry.contentBase64 || total > MAX_INPUT_FILE_BYTES) {
      throw new Error("invalid sandbox input file bytes");
    }
    names.add(entry.name);
    return { name: entry.name, contentBase64: entry.contentBase64 };
  });
}
