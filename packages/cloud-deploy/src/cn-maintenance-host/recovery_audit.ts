import type { MaintenanceIdentity } from '../cn-maintenance-release';
import type { CommandRunner, TrustedExecutable } from './fixed_transport';
/** Pre-hold artifact audit is separate from production restoration. Incomplete
 * common-snapshot/object proof is rejected by the actual verifier CLI. */
export function preholdRecoveryArtifactAudit(verifier: TrustedExecutable, toolRevision: string, evidenceSha256: string, run: CommandRunner) {
 if (verifier.path !== '/usr/local/lib/workspacex-cn/cn-maintenance-recovery-evidence-verifier.py' || !/^[a-f0-9]{40}$/.test(toolRevision) || !/^[a-f0-9]{64}$/.test(evidenceSha256)) throw new Error('PREHOLD_AUDIT_BINDING_INVALID');
 return async (identity: MaintenanceIdentity) => {
  if (!/^[a-f0-9]{40}$/.test(identity.sourceRevision) || !/^[A-Za-z0-9-]{1,128}$/.test(identity.attemptId)) throw new Error('PREHOLD_AUDIT_IDENTITY_INVALID');
  const path = `/etc/workspacex-cn/maintenance-evidence/${identity.sourceRevision}/${identity.attemptId}/recovery.json`;
  const result = await run(verifier,['--prehold-artifact-audit',path]);
  let value: any;try{value=JSON.parse(result.stdout);}catch{throw new Error('PREHOLD_AUDIT_RESPONSE_INVALID');}
  const same = value?.identity && Object.keys(value.identity).sort().join(',')===Object.keys(identity).sort().join(',') && Object.entries(identity).every(([key,expected])=>value.identity[key]===expected);
  if (!value || value.schemaVersion!==1 || value.kind!=='maintenance-recovery-artifact-audit' || !same || value.toolRevision!==toolRevision || value.evidenceSha256!==evidenceSha256 || value.localArtifactEquivalent!==true || !Array.isArray(value.threeDatabases) || [...value.threeDatabases].sort().join(',')!=='workspacex,workspacex_agent,workspacex_memory' || value.ready!==false || value.productionRecoveryVerified!==false) throw new Error('PREHOLD_AUDIT_RESPONSE_INVALID');
 };
}
