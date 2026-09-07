/** Browser-safe canonical package digest input. SHA-256 is applied by the consumer. */
export const SKILL_PACKAGE_DIGEST_ALGORITHM = {
  version: 1, hash: "sha256", encoding: "utf-8", ordering: "unicode-code-point",
  serialization: "compact-json-path-digest-pairs",
} as const;
export function canonicalSkillPackageManifest(files: readonly { path: string; digest: string }[]): string {
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.digest) || /[\uD800-\uDFFF]/u.test(file.path)) {
      throw new Error("Invalid package manifest");
    }
    seen.add(file.path);
  }
  const compare = (a: string, b: string): number => {
    const left = Array.from(a, c => c.codePointAt(0)!);
    const right = Array.from(b, c => c.codePointAt(0)!);
    for (let i=0; i<Math.min(left.length,right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
    return left.length-right.length;
  };
  return JSON.stringify([...files].sort((a,b)=>compare(a.path,b.path)).map(f=>[f.path,f.digest]));
}
