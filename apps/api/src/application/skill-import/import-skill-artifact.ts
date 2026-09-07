import type {z} from 'zod';
import {SkillArtifactImportInput,SKILL_DRAFT_LIMITS} from '@repo/contracts/standard-skill-draft';
import {CanonicalBase64} from '@repo/contracts/standard-capabilities';
import type {OrgId} from '../../domain/org-id';
import {sha256,verifySkillStarterPack} from '../../domain/skill/starter-pack';
import {getArtifact,type ArtifactReadDeps} from '../artifacts-steering/read-artifact';
import type {ObjectStore} from '../artifact/ports';
import {importSkillStarterPack,SkillStarterImportAdminRequiredError,SkillStarterImportIdempotencyConflictError,type ImportSkillStarterPackDeps} from './import-skill-starter-pack';
export const SKILL_ARTIFACT_IMPORT_DEPS=Symbol('SkillArtifactImportDeps');
export interface SkillArtifactImportDeps extends ArtifactReadDeps {objects:ObjectStore;identities:ImportSkillStarterPackDeps['identities'];imports:ImportSkillStarterPackDeps['imports']}
export async function importSkillArtifact(deps:SkillArtifactImportDeps,actor:{orgId:OrgId;userId:string},raw:z.infer<typeof SkillArtifactImportInput>){
 const input=SkillArtifactImportInput.parse(raw);
 const admin=async()=>{if((await deps.identities.findOrgMembership(actor.userId,actor.orgId))?.orgRole!=='admin')throw new SkillStarterImportAdminRequiredError();};
 await admin();
 const visible=await getArtifact(deps,{...actor,artifactId:input.artifactId});
 const version=visible.versions.find(v=>v.version===input.version);if(!version)throw new Error('skill_artifact_not_visible');
 const head=await deps.objects.head(version.storageKey);
 if(!head||head.sizeBytes!==version.sizeBytes||head.sizeBytes>SKILL_DRAFT_LIMITS.maxBytes||head.mime!=='application/json')throw new Error('skill_artifact_invalid');
 const value=await deps.objects.get(version.storageKey);
 if(!value||value.length!==head.sizeBytes||sha256(Buffer.from(value))!==input.expectedDigest)throw new Error('skill_artifact_digest_mismatch');
 const candidate=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value));
 const pack=verifySkillStarterPack(candidate,{packId:candidate.packId,packVersion:candidate.packVersion});
 if(pack.skills.length!==1||pack.skills[0]!.files.length>SKILL_DRAFT_LIMITS.maxFiles)throw new Error('skill_artifact_limit');
 for(const file of pack.skills[0]!.files){CanonicalBase64.parse(file.contentBase64);new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(file.contentBase64,'base64'));}
 // A role and source visibility can change during the object read; recheck before import.
 await admin();const after=await getArtifact(deps,{...actor,artifactId:input.artifactId});
 if(!after.versions.some(v=>v.version===input.version&&v.storageKey===version.storageKey&&v.sizeBytes===version.sizeBytes))throw new Error('skill_artifact_not_visible');
 const imported=await importSkillStarterPack({identities:deps.identities,imports:deps.imports,packs:{load:async(id,version)=>id===pack.packId&&version===pack.packVersion?pack:null}},
  {actorId:actor.userId,orgId:actor.orgId,packId:pack.packId,packVersion:pack.packVersion,idempotencyKey:input.idempotencyKey});
 if(imported.result.packDigest!==pack.packDigest)throw new SkillStarterImportIdempotencyConflictError();
 return imported;
}
