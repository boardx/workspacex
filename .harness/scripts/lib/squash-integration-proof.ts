/** Complete-tree squash reconstruction; never a test attestation or a waiver. */
export type ProofGit = (command: string) => { code: number; out: string };
export interface SquashReconstruction { source: string; squash: string; parent: string }
const oid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export function parseSquashReconstructions(body: string): SquashReconstruction[] {
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SQUASH_PROOF_CONFIG");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.proofs) || record.proofs.length > 20 ||
      Object.keys(record).some(key => !["version", "proofs"].includes(key))) throw new Error("SQUASH_PROOF_CONFIG");
  return record.proofs.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("SQUASH_PROOF_CONFIG");
    const p = item as Record<string, unknown>;
    if (Object.keys(p).sort().join(",") !== "parent,source,squash" ||
        !oid(p.source) || !oid(p.squash) || !oid(p.parent) || new Set([p.source,p.squash,p.parent]).size !== 3)
      throw new Error("SQUASH_PROOF_CONFIG");
    return { source: p.source, squash: p.squash, parent: p.parent };
  });
}
/** Writes only unreferenced Git objects via merge-tree; no refs, index or worktree changes.
 * No overridden merge base, conflict strategy, path filter or partial-tree comparison.
 */
export function reconstructedSquash(git: ProofGit, head: string, witness: string, logPath: string,
  evidenceBlob: string, proofs: SquashReconstruction[]): boolean {
  if (![head,witness,evidenceBlob].every(oid) || !/^phases\/[a-zA-Z0-9_./-]+\.verify\.log$/.test(logPath) ||
      logPath.split("/").includes("..")) return false;
  return proofs.some(p => {
    if (![p.source,p.squash,p.parent].every(oid) ||
        git(`cat-file -e ${witness}^{commit}`).code !== 0 ||
        git(`cat-file -e ${p.source}^{commit}`).code !== 0 ||
        git(`cat-file -e ${p.parent}^{commit}`).code !== 0 ||
        git(`cat-file -e ${p.squash}^{commit}`).code !== 0 ||
        git(`merge-base --is-ancestor ${witness} ${p.source}`).code !== 0 ||
        git(`merge-base --is-ancestor ${p.squash} ${head}`).code !== 0) return false;
    const parents = git(`rev-list --parents -n 1 ${p.squash}`);
    if (parents.code !== 0 || parents.out.trim() !== p.squash + " " + p.parent) return false;
    for (const ref of [p.source,p.squash]) {
      const blob = git(`rev-parse --verify ${ref}:${logPath}`);
      if (blob.code !== 0 || blob.out.trim() !== evidenceBlob) return false;
    }
    const target = git(`rev-parse --verify ${p.squash}^{tree}`);
    if (target.code !== 0 || !oid(target.out.trim())) return false;
    const rebuilt = git(`merge-tree --write-tree --no-messages ${p.parent} ${p.source}`);
    return rebuilt.code === 0 && oid(rebuilt.out.trim()) && rebuilt.out.trim() === target.out.trim();
  });
}
/** Keep the PR source, advancing main and synthetic integration as separate audited deltas. */
export function prTransitionPairs(git: ProofGit, eventBase: string, source: string, head: string): Array<[string,string]> {
  if (![eventBase,source,head].every(oid)) throw new Error("PR_TRANSITION_IDENTITY");
  const row = git(`rev-list --parents -n 1 ${head}`);
  const parts = row.out.trim().split(/\s+/);
  if (row.code !== 0 || parts.length !== 3 || parts[0] !== head || parts[2] !== source || !oid(parts[1]))
    throw new Error("PR_TRANSITION_PARENTS");
  const actualBase = parts[1];
  if (git(`merge-base --is-ancestor ${eventBase} ${actualBase}`).code !== 0 ||
      git(`merge-base ${actualBase} ${source}`).code !== 0) throw new Error("PR_TRANSITION_BASE");
  return [[eventBase,source],[eventBase,actualBase],[actualBase,head]];
}
