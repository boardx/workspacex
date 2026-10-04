import { rejectLegacyHeldPreflight } from './acceptance_contract';
import type { MaintenanceIdentity } from '../cn-maintenance-release';
import { type TrustedExecutable, type CommandRunner, protectedPrivateJson } from './fixed_transport';

const COLLECTOR = '/usr/local/lib/workspacex-cn/collect-cn-release-preflight.sh';
const VERIFIER = '/usr/local/lib/workspacex-cn/verify-cn-release-preflight.sh';
export function readProductionValidatedReceipt(identity: MaintenanceIdentity, release: string): Promise<void> {
  if (!/^[a-f0-9]{40}$/.test(identity.sourceRevision) || !/^[a-zA-Z0-9-]{1,128}$/.test(identity.attemptId)) throw new Error('DYNAMIC_IDENTITY_INVALID');
  const result = protectedPrivateJson(`/var/lib/workspacex-cn/preflight-receipts/${identity.sourceRevision}/${identity.attemptId}/preactivate.validated.json`) as any;
  const now = Date.now();
  if (!result || result.schemaVersion !== 2 || result.phase !== 'preactivate' || result.sourceSha !== identity.sourceRevision || result.baselineSha !== identity.baselineRevision || result.attemptId !== identity.attemptId || result.release !== release || result.ready !== true || result.buildStarted !== true || !Array.isArray(result.blockers) || result.blockers.length !== 0 || !/^[a-f0-9]{64}$/.test(result.receiptSha256) || !Number.isFinite(Date.parse(result.issuedAt)) || Date.parse(result.issuedAt) > now || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= now) throw new Error('PROTECTED_PREACTIVATE_READBACK_INVALID');
  return Promise.resolve();
}
/** The existing maintenance collector includes live schema/bootstrap probes; the
 * existing verifier owns validation and protected receipt persistence. Controller
 * never upgrades an arbitrary stdout ready flag into preactivation admission. */
export function productionDynamicActions(collector: TrustedExecutable, verifier: TrustedExecutable, release: string,
  runBash: CommandRunner, readValidatedReceipt: (identity: MaintenanceIdentity, release: string) => Promise<void>) {
  if (collector.path !== COLLECTOR || verifier.path !== VERIFIER) throw new Error('PREFLIGHT_COMMAND_AUTHORITY');
  if (!/^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*)?$/.test(release)) throw new Error('RELEASE_INVALID');
  let collectedIdentity: MaintenanceIdentity | undefined;
  return {
    verifyProductionDynamic: async (identity: MaintenanceIdentity) => {
      if (!/^[a-f0-9]{40}$/.test(identity.sourceRevision) || !/^[a-zA-Z0-9-]{1,128}$/.test(identity.attemptId)) throw new Error('DYNAMIC_IDENTITY_INVALID');
      // Legacy collector starts a bootstrap container/new connections. Never
      // run it while every ordinary writer is held or call its result held PASS.
      rejectLegacyHeldPreflight();
    },
    verifyPreactivate: async (identity: MaintenanceIdentity) => {
      if (!collectedIdentity || JSON.stringify(collectedIdentity) !== JSON.stringify(identity)) throw new Error('DYNAMIC_GATE_NOT_COLLECTED');
      await runBash(verifier, ['--maintenance', 'preactivate', identity.sourceRevision, release, identity.attemptId]);
      await readValidatedReceipt(identity, release);
    },
  };
}
