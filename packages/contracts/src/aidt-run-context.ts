/** User-approved AIDT server-selected run context. Client selectors never grant authority. */
import { z } from "zod";
import { StageId, SourceStageRevision } from "./aidt-stages";

export const AIDT_STAGE_IDENTITIES = [
  { id: 1, skill: "aidt-understand", title: "理解与提出问题" },
  { id: 2, skill: "aidt-empathize", title: "共情用户" },
  { id: 3, skill: "aidt-define", title: "综合与定义" },
  { id: 4, skill: "aidt-ideate", title: "创意发散" },
  { id: 5, skill: "aidt-prototype", title: "制作原型" },
  { id: 6, skill: "aidt-iterate", title: "测试与迭代" },
] as const;
export const AIDT_SUMMARY_STABLE_NAME = "dt-summarize-project";
export const AIDT_CONTEXT_LIMITS = {
  selectorBytes: 8 * 1024, stageReferences: 6, historyReferences: 60,
  historyPerStage: 10, prepareTimeoutMs: 20_000, referenceMessageBytes: 128 * 1024, referenceEnvelopeReserveBytes: 1024,
  currentExcerptChars: 5000, historyExcerptChars: 1200, historyTotalChars: 18000,
} as const;
const identifier = z.string().min(1).max(256).refine(v => v.trim()===v && v!=="." && v!==".." && !/[\u0000-\u001f\u007f]/u.test(v));
export const AidtContextHash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().positive().safe().max(Number.MAX_SAFE_INTEGER - 1);
export const AidtContextStageRevision = SourceStageRevision.extend({revision});
export type AidtContextStageRevision = z.infer<typeof AidtContextStageRevision>;
const stageRefs=z.array(AidtContextStageRevision).max(AIDT_CONTEXT_LIMITS.stageReferences);
const selectorBase={schemaVersion:z.literal(1),projectId:identifier,stageRevisions:stageRefs};
export const AidtContextSelector=z.discriminatedUnion("purpose",[
  z.object({...selectorBase,purpose:z.literal("stage"),stageId:StageId,returnRevision:revision.optional()}).strict(),
  z.object({...selectorBase,purpose:z.literal("summary"),historyRevisions:z.array(AidtContextStageRevision).max(AIDT_CONTEXT_LIMITS.historyReferences).default([])}).strict(),
]).superRefine((v,ctx)=>{
  if(new Set(v.stageRevisions.map(r=>r.stageId)).size!==v.stageRevisions.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:"One selected current revision per stage"});
  if(v.purpose==="stage") {
    if(v.stageRevisions.some(r=>r.stageId>v.stageId))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Future stages are not current-stage input"});
    if(v.stageId===6 && v.returnRevision!==undefined)ctx.addIssue({code:z.ZodIssueCode.custom,message:"A return target is one of stages one through five"});
  } else {
    const keys=v.historyRevisions.map(r=>`${r.stageId}:${r.revision}`);
    if(new Set(keys).size!==keys.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Duplicate history reference"});
    for(let id=1;id<=6;id++)if(v.historyRevisions.filter(r=>r.stageId===id).length>AIDT_CONTEXT_LIMITS.historyPerStage)ctx.addIssue({code:z.ZodIssueCode.custom,message:"History per-stage limit exceeded"});
  }
  if(new TextEncoder().encode(JSON.stringify(v)).length>AIDT_CONTEXT_LIMITS.selectorBytes)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Selector byte limit exceeded"});
});
export type AidtContextSelector=z.infer<typeof AidtContextSelector>;
export const AidtContextOmission=z.object({
  kind:z.enum(["missing","not-selected","truncated","personal-artifacts-not-included","original-file-bytes-not-read","teacher-comments-no-source","lineage-unknown"]),
  stageId:StageId.optional(),revision:revision.optional(),note:z.string().max(400).optional(),
}).strict();
export type AidtContextOmission=z.infer<typeof AidtContextOmission>;
export const AidtContextSource=z.object({kind:z.enum(["stage","history","return"]),stageId:StageId,revision,updatedBy:identifier,updatedAt:z.string().datetime(),truncated:z.boolean(),lineage:z.literal("unknown")}).strict();
export type AidtContextSource=z.infer<typeof AidtContextSource>;
export const AidtContextFocus=z.object({skillId:identifier,skillVersionId:identifier,skillStableName:identifier,title:z.string().min(1).max(200)}).strict();
export const AidtContextSnapshot=z.object({
  schemaVersion:z.literal(1),selector:AidtContextSelector,focus:AidtContextFocus,
  sources:z.array(AidtContextSource).max(67),omissions:z.array(AidtContextOmission).max(100),
  formatterVersion:z.literal(1),modelReferenceBlock:z.string().min(1).refine(v=>new TextEncoder().encode(JSON.stringify({role:"user",content:v})).length<=AIDT_CONTEXT_LIMITS.referenceMessageBytes-AIDT_CONTEXT_LIMITS.referenceEnvelopeReserveBytes,"Final reference message exceeds byte budget"),
  modelReferenceBlockHash:AidtContextHash,truncated:z.boolean(),
}).strict();
export type AidtContextSnapshot=z.infer<typeof AidtContextSnapshot>;
export const PreparedAidtContext=z.object({selectorHash:AidtContextHash,snapshotHash:AidtContextHash,snapshot:AidtContextSnapshot}).strict();
export type PreparedAidtContext=z.infer<typeof PreparedAidtContext>;
export const AidtStoredContextSnapshot=PreparedAidtContext.extend({orgId:identifier,runId:identifier,projectId:identifier,threadId:identifier,inputMessageId:identifier,requestedBy:identifier,preparedAt:z.string().datetime()}).strict();
export type AidtStoredContextSnapshot=z.infer<typeof AidtStoredContextSnapshot>;
export const AidtContextErrorCode=z.enum(["AIDT_CONTEXT_INVALID","AIDT_CONTEXT_TOO_LARGE","AIDT_CONTEXT_NOT_AVAILABLE","AIDT_CONTEXT_CONFLICT","AIDT_CONTEXT_UNAVAILABLE","AIDT_CONTEXT_SNAPSHOT_MISSING","AIDT_CONTEXT_SNAPSHOT_MISMATCH"]);
export type AidtContextErrorCode=z.infer<typeof AidtContextErrorCode>;
const appBase={attemptId:identifier,snapshotHash:AidtContextHash};
export const AidtContextApplicationInput=z.discriminatedUnion("kind",[
  z.object({...appBase,kind:z.literal("assembled"),assembledContextHash:AidtContextHash,formatterVersion:z.literal(1)}).strict(),
  z.object({...appBase,kind:z.literal("message-dispatch-observed"),assembledContextHash:AidtContextHash,formatterVersion:z.literal(1),remoteThreadId:identifier.optional(),remoteRunId:identifier.optional()}).strict(),
  z.object({...appBase,kind:z.literal("checkpoint-resume-observed"),inheritedMessageDispatchAttemptId:identifier.nullable(),assembledContextHash:AidtContextHash.nullable(),remoteThreadId:identifier.optional(),remoteRunId:identifier.optional()}).strict(),
  z.object({...appBase,kind:z.literal("failed"),errorCode:AidtContextErrorCode}).strict(),
]);
export type AidtContextApplicationInput=z.infer<typeof AidtContextApplicationInput>;
export const AidtContextApplicationEvent=z.object({runId:identifier,seq:z.number().int().positive(),occurredAt:z.string().datetime(),event:AidtContextApplicationInput}).strict();
export type AidtContextApplicationEvent=z.infer<typeof AidtContextApplicationEvent>;
export const AidtContextReceipt=z.object({
  runId:identifier,projectId:identifier,purpose:z.enum(["stage","summary"]),stageId:StageId.optional(),skillVersionId:identifier,
  snapshotHash:AidtContextHash,preparedAt:z.string().datetime(),stageRevisions:stageRefs,
  historyRevisions:z.array(AidtContextStageRevision).max(AIDT_CONTEXT_LIMITS.historyReferences),returnRevision:revision.optional(),
  omissions:z.array(AidtContextOmission).max(100),truncated:z.boolean(),
  application:z.object({state:z.enum(["prepared","assembled","message-dispatch-observed","checkpoint-resume-observed","failed-before-dispatch","unknown"]),attemptId:identifier.nullable(),assembledContextHash:AidtContextHash.nullable(),assembledAt:z.string().datetime().nullable(),messageDispatchedAt:z.string().datetime().nullable(),checkpointResumedAt:z.string().datetime().nullable(),inheritedMessageDispatchAttemptId:identifier.nullable()}).strict(),
}).strict().superRefine((v,ctx)=>{
  if((v.purpose==="stage")!==(v.stageId!==undefined) || (v.purpose==="summary"&&v.returnRevision!==undefined))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Receipt task coordinates mismatch"});
});
export type AidtContextReceipt=z.infer<typeof AidtContextReceipt>;
/** Isomorphic canonical serialization; hashing uses the existing server SHA256 helper. */
export function aidtContextCanonicalJson(value:unknown):string {
  if(value===null || typeof value!=="object") { const encoded=JSON.stringify(value); if(encoded===undefined)throw new TypeError("Expected JSON value"); return encoded; }
  if(Array.isArray(value))return `[${value.map(aidtContextCanonicalJson).join(",")}]`;
  return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${aidtContextCanonicalJson(v)}`).join(",")}}`;
}
export function aidtContextSelectorJson(raw:AidtContextSelector):string {
  const v=AidtContextSelector.parse(raw);const order=(a:AidtContextStageRevision,b:AidtContextStageRevision)=>a.stageId-b.stageId||a.revision-b.revision;
  return aidtContextCanonicalJson({...v,stageRevisions:[...v.stageRevisions].sort(order),...(v.purpose==="summary"?{historyRevisions:[...v.historyRevisions].sort(order)}:{})});
}
export function aidtContextSnapshotJson(raw:AidtContextSnapshot):string {const value=AidtContextSnapshot.parse(raw);return aidtContextCanonicalJson({...value,selector:JSON.parse(aidtContextSelectorJson(value.selector))});}
export const operations={receipt:{method:"GET",path:"/agent-runs/:runId/aidt-context",in:z.object({runId:identifier}).strict(),out:AidtContextReceipt,err:["AIDT_CONTEXT_NOT_AVAILABLE","AIDT_CONTEXT_UNAVAILABLE"] as const}} as const;
