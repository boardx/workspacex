/** Pure shared validation of saved student reflections; confirmation is never evidence or group authority. */
import { z } from "zod";
import * as design from "./design-workbench";
export const AIDT_TEST_GROUP_ROUND_PREFIX = "testRound:";
export type AidtReflectionDraft = { fields: Readonly<Record<string,string>> };
export const AIDT_RETURN_STEPS=[{id:"1",label:"理解问题"},{id:"2",label:"共情用户"},{id:"3",label:"综合定义"},{id:"4",label:"创意发散"},{id:"5",label:"原型制作"}] as const;
export type AidtReturnStep=(typeof AIDT_RETURN_STEPS)[number]["id"];
export type AidtQuestionSnapshot={schemaVersion:1;question:string;beforeTestBelief:string;verificationBasis:string;verificationLimits:string;prototypeRef:string;prototypeDesignId?:string;prototypeVersionId?:string;sourceStageRevision:number|null};
export const AidtPrototypeIdentifierSchema=design.PrototypeVersionSummary.shape.id.refine(id=>!!id.trim()&&id!=="."&&id!==".."&&!/[\u0000-\u001f\u007f]/.test(id),"Use an actual native identifier");
export const AidtPrototypeReferenceSchema=design.PrototypeVersionSummary.pick({seq:true,summary:true,createdAt:true,source:true}).extend({designId:AidtPrototypeIdentifierSchema,versionId:AidtPrototypeIdentifierSchema,designName:design.DesignProject.innerType().shape.name,frameCount:z.number().int().positive().safe(),generatedFrameCount:z.number().int().positive().safe()}).strict().refine(ref=>ref.generatedFrameCount<=ref.frameCount,"Generated pages cannot exceed planned pages");
const value=(draft:AidtReflectionDraft,key:string)=>draft.fields[key]?.trim()??"";
export function readAidtQuestionSnapshot(draft:AidtReflectionDraft):AidtQuestionSnapshot|null {
 const raw=draft.fields.questionSnapshot;if(!raw||raw.length>6000)return null;
 try{const parsed:unknown=JSON.parse(raw);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return null;const r=parsed as Record<string,unknown>;
  if(r.schemaVersion!==1||typeof r.question!=="string"||!r.question.trim()||typeof r.prototypeRef!=="string"||!r.prototypeRef.trim()||["beforeTestBelief","verificationBasis","verificationLimits"].some(k=>typeof r[k]!=="string")||!(r.sourceStageRevision===null||(Number.isSafeInteger(r.sourceStageRevision)&&Number(r.sourceStageRevision)>0)))return null;
  const native=r.prototypeDesignId!==undefined||r.prototypeVersionId!==undefined;if(native&&(!AidtPrototypeIdentifierSchema.safeParse(r.prototypeDesignId).success||!AidtPrototypeIdentifierSchema.safeParse(r.prototypeVersionId).success))return null;
  return {schemaVersion:1,question:r.question,beforeTestBelief:r.beforeTestBelief as string,verificationBasis:r.verificationBasis as string,verificationLimits:r.verificationLimits as string,prototypeRef:r.prototypeRef,sourceStageRevision:r.sourceStageRevision as number|null,...(native?{prototypeDesignId:r.prototypeDesignId as string,prototypeVersionId:r.prototypeVersionId as string}:{})};
 }catch{return null;}
}
export function aidtTestPrototypeMismatch(draft:AidtReflectionDraft,snapshot=readAidtQuestionSnapshot(draft)):boolean {
 if(!snapshot)return false;const raw=value(draft,"prototypeReference");let ref:z.infer<typeof AidtPrototypeReferenceSchema>|null=null;
 if(raw){try{const parsed=AidtPrototypeReferenceSchema.safeParse(JSON.parse(raw));if(raw.length<=6000&&parsed.success)ref=parsed.data;}catch{}if(!ref)return true;}
 if(ref)return ref.designId!==snapshot.prototypeDesignId||ref.versionId!==snapshot.prototypeVersionId;
 return !!value(draft,"version")&&value(draft,"version")!==snapshot.prototypeRef.trim();
}
export function readAidtReturnDecision(draft:AidtReflectionDraft):{kind:"selected";step:AidtReturnStep;label:string}|{kind:"undecided"}|{kind:"unanswered"}{const choice=value(draft,"returnStep"),selected=AIDT_RETURN_STEPS.find(s=>s.id===choice);return selected?{kind:"selected",step:selected.id,label:selected.label}:choice==="undecided"?{kind:"undecided"}:{kind:"unanswered"};}
export function aidtReflectionMissingItems(draft:AidtReflectionDraft):string[]{const missing:string[]=[],status=value(draft,"understandingChangeStatus"),decision=readAidtReturnDecision(draft),snapshot=readAidtQuestionSnapshot(draft);
 if(!snapshot)missing.push("带入本轮原问题与被测版本");if(aidtTestPrototypeMismatch(draft,snapshot))missing.push("核对被测版本与本轮问题绑定的原型版本");
 if(!["changed","unchanged","insufficient"].includes(status))missing.push("说明认识是否改变或证据不足");if(!value(draft,"afterTestBelief")&&status!=="insufficient")missing.push("填写测试后的认识");
 if(!value(draft,"understandingEvidence")&&!(status==="insufficient"&&value(draft,"unresolvedQuestions")))missing.push("说明材料依据或证据不足之处");if(decision.kind==="unanswered")missing.push("选择优先返回步骤或明确暂未决定");
 if(!value(draft,"returnReason"))missing.push(decision.kind==="undecided"?"说明需要的支持":"说明返回的理由");if(decision.kind==="selected"&&!value(draft,"nextAction"))missing.push("写下下一步具体行动");return missing;
}
export function isAidtReflectionConfirmed(draft:AidtReflectionDraft):boolean{return draft.fields.reflectionConfirmed==="true"&&aidtReflectionMissingItems(draft).length===0;}
export function readConfirmedAidtReturn(draft:AidtReflectionDraft,targetStage:number){const snapshot=readAidtQuestionSnapshot(draft),decision=readAidtReturnDecision(draft);if(!Number.isInteger(targetStage)||targetStage<1||targetStage>5||!snapshot||!isAidtReflectionConfirmed(draft)||decision.kind!=="selected"||Number(decision.step)!==targetStage)return null;
 return {snapshot,targetStage,fields:{originalQuestion:snapshot.question,beforeTestBelief:snapshot.beforeTestBelief,afterTestBelief:draft.fields.afterTestBelief??"",returnReason:draft.fields.returnReason??"",nextAction:draft.fields.nextAction??"",prototypeRef:snapshot.prototypeRef,understandingChangeStatus:draft.fields.understandingChangeStatus??"",understandingEvidence:draft.fields.understandingEvidence??"",unresolvedQuestions:draft.fields.unresolvedQuestions??""}};
}
