import { randomUUID } from "node:crypto";
import { files } from "@repo/contracts";
import type { z } from "zod";
import type { Principal } from "../../domain/principal";
import { computeContentHash, versionContentHash } from "../../domain/artifact/content-hash";
import { sniffKind } from "../../domain/files/mime-sniff";
import { originalDownloadable, retrievable } from "../../domain/files/ingestion-visibility";
import { CURRENT_PARSER_VERSION, CURRENT_PIPELINE_VERSION } from "../../domain/files/idempotency-key";
import { authorize } from "../identity/authorize";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ArtifactRepository, IdFactory, ObjectStore } from "../artifact/ports";
import { materializeArtifact } from "../artifact/materialize-artifact";
import { uploadArtifact, type UploadFileInput } from "../files/upload-artifact";
import type { SecurityAlertPort } from "../files/upload-ports";
import type { AidtRawFilesRepository, RawActor, RawTransaction } from "./ports";

export class AidtRawFileError extends Error {
  constructor(readonly reasonCode: string, readonly httpStatus: number) { super(reasonCode); }
}
function fail(code: string, status: number): never { throw new AidtRawFileError(code, status); }
type UploadMeta = z.infer<typeof files.operations.uploadArtifact.in>;
function mime(bytes: Uint8Array): string {
  const kind = sniffKind(bytes);
  return ({pdf:"application/pdf",png:"image/png",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",mp3:"audio/mpeg",wav:"audio/wav",mp4:"video/mp4",zip:"application/zip",text:"text/plain; charset=utf-8"} as Partial<Record<typeof kind,string>>)[kind] ?? "application/octet-stream";
}
/** AIDT adapter for the signed files upload use case. Raw uploads never create Chat runs. */
export class AidtRawFilesService {
  constructor(private readonly repo:AidtRawFilesRepository, private readonly store:ObjectStore,
    private readonly ids:IdFactory, private readonly alerts:SecurityAlertPort,
    private readonly enabled:()=>boolean=()=>false) {}
  private async access<T>(actor:RawActor, write:boolean, fn:(tx:RawTransaction)=>Promise<T>):Promise<T> {
    if(!this.enabled()) fail("ARTIFACT_NOT_FOUND",404);
    return this.repo.inProject(actor,async tx=>{
      if(!tx.project?.aidt) fail("ARTIFACT_NOT_FOUND",404);
      const standing=await tx.identity.findNonWorkshopStanding(actor.userId,actor.projectId,actor.orgId);
      if(standing?.memberRole==null) fail("ARTIFACT_NOT_FOUND",404);
      const auth={repo:tx.identity,ids:{next:()=>randomUUID()}};
      const read=await authorize(auth,{...actor,object:{kind:"project",id:actor.projectId},action:"read.allHands"});
      if(!read.allowed) fail("ARTIFACT_NOT_FOUND",404);
      if(write) {
        const allowed=await authorize(auth,{...actor,object:{kind:"project",id:actor.projectId},action:"content.renameFile"});
        if(!allowed.allowed || tx.project.status!=="active" || tx.project.orgStatus!=="active") fail("PROJECT_ROLE_INSUFFICIENT",403);
      }
      return fn(tx);
    });
  }
  authorizeUpload(actor:RawActor) { return this.access(actor,true,async()=>undefined); }
  async upload(actor:RawActor, meta:UploadMeta, parts:readonly UploadFileInput[]) {
    // One-file transport is deliberate: the signed batch response has no per-file rejection
    // shape. Do not partially commit a batch and hide the successful uploads behind an error.
    if(parts.length!==1 || meta.files.length!==1) fail("AIDT_UPLOAD_SINGLE_FILE_REQUIRED",422);
    const part=parts[0]!, declared=meta.files[0]!;
    if(meta.agendaSegmentId!==null || meta.projectId!==actor.projectId || part.filename!==declared.filename || part.bytes.length!==declared.sizeBytes || !/^[a-f0-9]{64}$/i.test(declared.sha256) || computeContentHash(part.bytes)!==declared.sha256.toLowerCase() || !part.bytes.length || /[\x00-\x1f\x7f/\\]/.test(part.filename)) fail("AIDT_UPLOAD_METADATA_MISMATCH",422);
    const result=await this.access(actor,true,async tx=>{
      const org=await tx.identity.findOrgMembership(actor.userId,actor.orgId);
      if(meta.visibilityScope==="team-only" && !org?.teamId) fail("PROJECT_ROLE_INSUFFICIENT",403);
      const base=tx.artifacts;
      // Keep the F35 security/idempotency pipeline. Its repository lookup additionally
      // filters visibility and metadata BEFORE LIMIT, so an incompatible oldest hash
      // match cannot hide a later reusable version. Recheck ACL before disclosing ids.
      const artifacts=Object.create(base) as ArtifactRepository;
      artifacts.findVersionByIdempotencyKey=async (...args:Parameters<ArtifactRepository["findVersionByIdempotencyKey"]>)=>{
        if(args[0]!==actor.orgId || args[1]!==actor.projectId) throw new Error("raw duplicate tenant mismatch");
        const hit=await tx.findReusableVersion(args[2],args[3],args[4],meta.visibilityScope,meta.confidential,meta.agendaSegmentId);
        if(!hit) return null;
        const decision=await authorize({repo:tx.identity,ids:{next:()=>randomUUID()}},{...actor,object:{kind:"artifact",id:hit.artifactId},action:"read.allHands"});
        return decision.allowed?hit:null;
      };
      const outcome=(await uploadArtifact({store:this.store,repo:artifacts,ids:this.ids,quarantine:tx.quarantine,alerts:this.alerts,provenance:tx.provenance},{orgId:actor.orgId,projectId:actor.projectId,agendaSegmentId:meta.agendaSegmentId,confidential:meta.confidential,actorId:actor.userId,files:parts})).files[0]!;
      // Return rejection so the quarantine/security audit commits before the HTTP error.
      if(outcome.status==="rejected") {
        if(outcome.reason.kind==="DEPENDENCY_UNAVAILABLE") fail("DEPENDENCY_UNAVAILABLE",503);
        return outcome;
      }
      let versionId=outcome.versionId;
      if(outcome.duplicate && meta.onDuplicate==="as-new-version") {
        const allowed=await authorize({repo:tx.identity,ids:{next:()=>randomUUID()}},{...actor,object:{kind:"artifact",id:outcome.artifactId},action:"content.renameFile"});
        if(!allowed.allowed) fail("PROJECT_ROLE_INSUFFICIENT",403);
        const saved=await materializeArtifact({store:this.store,repo:artifacts,ids:this.ids},{orgId:actor.orgId,artifactId:outcome.artifactId,projectId:actor.projectId,source:"upload",title:part.filename,actorId:actor.userId,versionNumber:(await artifacts.headVersionNumber(actor.orgId,outcome.artifactId))+1,parts:{original:part.bytes},ingestionStatus:"STORED",versionChangeSource:"upload",pipelineVersion:CURRENT_PIPELINE_VERSION,parserVersion:CURRENT_PARSER_VERSION});
        versionId=saved.versionId;
        await tx.provenance.append({orgId:actor.orgId,type:"ingested",actorId:actor.userId,target:{kind:"artifact",id:outcome.artifactId},detail:{duplicate:true,explicitNewVersion:true,priorVersionId:outcome.versionId,versionId:saved.versionId,versionNumber:saved.versionNumber,contentHash:computeContentHash(part.bytes)}});
      }
      if(!outcome.duplicate) await tx.bindVisibility(outcome.artifactId,meta.visibilityScope,org?.teamId??null);
      const runId=this.ids.next("ingest");
      if(runId===versionId || runId===outcome.artifactId) throw new Error("ingestion receipt identity collision");
      await tx.insertRun({id:runId,projectId:actor.projectId,artifactId:outcome.artifactId,versionId,filename:part.filename,mime:mime(part.bytes),sha256:computeContentHash(part.bytes),sizeBytes:part.bytes.length});
      return {status:"accepted" as const,runs:[{ingestionRunId:runId,artifactId:outcome.artifactId,duplicateHit:outcome.duplicate?{artifactId:outcome.artifactId,versionNumber:outcome.versionNumber,sha256:computeContentHash(part.bytes)}:null}]};
    });
    if(result.status==="rejected") fail(result.reason.kind,result.reason.kind==="DEPENDENCY_UNAVAILABLE"?503:422);
    return files.operations.uploadArtifact.out.parse({runs:result.runs});
  }
  private async read<T>(actor:Principal, runId:string, expectedProject:string|undefined, fn:(row:import("./ports").RawContent)=>Promise<T>) {
    if(!this.enabled()) fail("ARTIFACT_NOT_FOUND",404);
    const projectId=await this.repo.projectForRun(actor,runId);
    if(!projectId || (expectedProject!==undefined && expectedProject!==projectId)) fail("ARTIFACT_NOT_FOUND",404);
    return this.access({...actor,projectId},false,async tx=>{
      const guarded=await tx.content(runId);
      if(!guarded || guarded.ref.kind!=="artifact") fail("ARTIFACT_NOT_FOUND",404);
      const decision=await authorize({repo:tx.identity,ids:{next:()=>randomUUID()}},{...actor,projectId,object:{kind:"artifact",id:guarded.ref.id},action:"read.allHands"});
      const value=discloseDecided(guarded,decision);
      if(!isDisclosed(value)) fail("ARTIFACT_NOT_FOUND",404);
      return fn(value.payload);
    });
  }
  status(actor:Principal,runId:string,projectId?:string) {
    return this.read(actor,runId,projectId,async row=>{
      if(row.failed) fail("INGESTION_FAILED",422);
      const status=row.history.at(-1)??"STORED";
      return files.operations.getIngestionRun.out.parse({ingestionRunId:runId,status,history:row.history,originalDownloadable:originalDownloadable(status),retrievable:retrievable(status)});
    });
  }
  content(actor:Principal,runId:string,projectId:string) {
    return this.read(actor,runId,projectId,async row=>{
      let bytes:Uint8Array|null;
      try {bytes=await this.store.get(row.objectKey);} catch {fail("DEPENDENCY_UNAVAILABLE",503);}
      if(!bytes) fail("DEPENDENCY_UNAVAILABLE",503);
      if(bytes.length!==row.sizeBytes || computeContentHash(bytes)!==row.sha256 || versionContentHash([row.sha256])!==row.versionHash || mime(bytes)!==row.mime) fail("INTEGRITY_CHECK_FAILED",422);
      return {bytes,mime:row.mime,name:row.filename,sha256:row.sha256,artifactId:row.artifactId,versionId:row.versionId,submittedBy:row.submittedBy,submittedAt:row.submittedAt};
    });
  }
}
