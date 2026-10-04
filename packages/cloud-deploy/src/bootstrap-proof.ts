/** Accept only the candidate's read-only dynamic proof, after its migrations.
 * This consumes a real probe result; source/static and baseline proofs cannot substitute.
 */
export function assertPostMigrationBootstrap(output: string, sourceSha: string, imageDigest: string): void {
  try {
    if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^sha256:[a-f0-9]{64}$/.test(imageDigest)
      || !/^CN_BOOTSTRAP_COMPAT_JSON=[^\n]+\n$/.test(output)) throw new Error();
    const value = JSON.parse(output.slice("CN_BOOTSTRAP_COMPAT_JSON=".length)) as Record<string, unknown>;
    const checks = value.checks as Record<string, unknown> | undefined;
    if (value.schemaVersion !== 1 || value.sourceSha !== sourceSha || value.imageDigest !== imageDigest
      || value.phase !== "preactivate" || value.ready !== true || value.readOnlyTransaction !== true
      || value.productionWriteStatements !== 0 || !Array.isArray(value.blockers) || value.blockers.length
      || !["empty", "matching-existing"].includes(String(value.stateClass))
      || !checks || ["imageEntrypoint", "inputContract", "schemaContract", "permissionContract", "agentSeedContract", "migrationLedgerContract"].some(k => checks[k] !== true)
      || "sourceEntrypoint" in checks || "baselineCompatibility" in value || "buildAdmissionOnly" in value) throw new Error();
  } catch { throw new Error("POST_MIGRATION_BOOTSTRAP_UNPROVEN"); }
}
