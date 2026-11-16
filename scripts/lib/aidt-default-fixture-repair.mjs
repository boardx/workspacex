import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const requireFact = (value, code) => { if(!value)throw new Error(code); };
export function validateLaunch(attestation, actual) {
  requireFact(attestation.readOnly===true&&attestation.paidWindowOpened===false&&attestation.agentAutoExecution===false,'FIXTURE_PAID_WINDOW_NOT_CLOSED');
  const keys=['agentRuns','skillTrialRuns','attachmentExtraction','threadTitleModel','standardScheduler'];
  requireFact(keys.every(key=>attestation.guards?.[key]==='0'),'FIXTURE_EXECUTOR_NOT_ZERO');
  requireFact(actual.pid===attestation.ownership?.api?.pid&&actual.startTicks===attestation.ownership.api.startTicks&&actual.processGroup===attestation.ownership.api.processGroup&&actual.state!=='Z','FIXTURE_API_PROCESS_OWNERSHIP_CHANGED');
}
export function validateBefore(facts, expected) {
  const {agent,version,role,accounting,membership}=facts;
  requireFact(role.current_user==='app_rw'&&!role.rolsuper&&!role.rolbypassrls,'FIXTURE_REQUIRES_TENANT_APP_RW');
  requireFact(agent.org_id===expected.orgId&&agent.id===expected.agentId&&agent.stable_name===expected.stableName&&agent.creator_id===expected.actorId&&agent.status==='enabled','FIXTURE_AGENT_SCOPE_MISMATCH');
  requireFact(membership?.org_role==='admin','FIXTURE_FUNDED_ADMIN_MEMBERSHIP_REQUIRED');
  requireFact(agent.published_version_id===expected.oldVersionId&&version.id===expected.oldVersionId&&version.org_id===expected.orgId&&version.agent_id===expected.agentId,'FIXTURE_OLD_POINTER_CHANGED');
  requireFact(version.instruction_digest===expected.echoDigest&&hash(version.instructions)===expected.echoDigest,'FIXTURE_EXPECTED_ECHO_DIGEST_REQUIRED');
  requireFact(accounting.active===0&&accounting.unsettled===0&&accounting.held==='0'&&accounting.remainingHeld==='0'&&accounting.unbounded==='0','FIXTURE_ACTIVE_OR_UNSETTLED_WORK');
  requireFact(version.model_provider&&version.model_id&&Array.isArray(version.skill_version_ids)&&Array.isArray(version.tool_policy),'FIXTURE_OLD_MODEL_POLICY_INVALID');
}
export function preservedVersion(row) {
  const {id,semantic_label,instruction_digest,instructions,creator_id,created_at,published_at,...preserved}=row;
  return preserved;
}
export function assertAfter(before,after,newVersion,plan) {
  requireFact(hash(before.protected)===hash(after.protected),'FIXTURE_PROTECTED_DATA_CHANGED');
  const {published_version_id:oldPointer,...oldAgent}=before.agent,{published_version_id:newPointer,...newAgent}=after.agent;
  requireFact(oldPointer===plan.oldVersionId&&newPointer===plan.newVersionId&&hash(oldAgent)===hash(newAgent),'FIXTURE_AGENT_CHANGED_BEYOND_POINTER');
  requireFact(hash(before.versions)===hash(after.versions.filter(row=>row.id!==plan.newVersionId))&&after.versions.length===before.versions.length+1,'FIXTURE_OLD_VERSIONS_CHANGED');
  requireFact(newVersion.id===plan.newVersionId&&newVersion.semantic_label===plan.semanticLabel&&newVersion.instruction_digest===plan.canonicalDigest&&hash(newVersion.instructions)===plan.canonicalDigest,'FIXTURE_NEW_VERSION_IDENTITY_INVALID');
  requireFact(hash(preservedVersion(before.version))===hash(preservedVersion(newVersion)),'FIXTURE_MODEL_POLICY_OR_ROLE_FIELDS_CHANGED');
}
export async function appendFixtureVersion(session,before,plan,canonicalInstructions,insertVersion) {
  requireFact(hash(canonicalInstructions)===plan.canonicalDigest,'FIXTURE_CANONICAL_INSTRUCTIONS_CHANGED');
  await insertVersion(session,{versionId:plan.newVersionId,orgId:plan.orgId,agentId:plan.agentId,semanticLabel:plan.semanticLabel,instructionDigest:plan.canonicalDigest,instructions:canonicalInstructions,skillVersionIds:before.version.skill_version_ids,modelProvider:before.version.model_provider,modelId:before.version.model_id,toolPolicy:before.version.tool_policy,creatorId:plan.actorId,at:new Date().toISOString(),roleFromVersionId:plan.oldVersionId});
  const changed=await session.query('UPDATE agents SET published_version_id=$3 WHERE org_id=$1 AND id=$2 AND published_version_id=$4 RETURNING id',[plan.orgId,plan.agentId,plan.newVersionId,plan.oldVersionId]);
  requireFact(changed.rows.length===1,'FIXTURE_POINTER_CAS_FAILED');
}
