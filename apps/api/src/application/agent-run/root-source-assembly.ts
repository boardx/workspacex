import {withAttachmentNotice} from "./attachment-notice";
import {bindRootAssembly,rootSourceHash,type RootInputSource} from "./root-input-source-provenance";
import type {ClaimedAgentRun,ModelCallInput,ThreadHistoryMessage} from "./ports";
import type {WholeInputSubject} from "./whole-input-binding-producer";

export interface SummarySourceSnapshot {
 message:ThreadHistoryMessage|null;
 evidence:{readonly source:RootInputSource;readonly sourceSha256:string}|null;
}
/** V9-b 前置 A（#970）：把附件元数据折进模型可见的 content——历史每轮 + 当前触发消息。
 * 触发消息的附件走 run.inputAttachments；它不在 history 里，必须单独带。
 * 保留变换前的消息对象和来源坐标，正文变换之后才能绑定最终容器 hash。
 */
export function assembleAttachmentContext(run:ClaimedAgentRun,sourceHistory:readonly ThreadHistoryMessage[]) {
 return {
  sourceHistory,
  history:sourceHistory.map(message=>({role:message.role,content:withAttachmentNotice(message.content,message.attachments)})),
  user:withAttachmentNotice(run.inputText,run.inputAttachments),
 };
}

/** Binds original repository coordinates to final assembled containers. This records
 * contribution lineage, not a substring match or a confidentiality classification.
 * Source hashes stay lazy so default-off execution does not serialize new metadata.
 */
export function bindAssembledRootInput(
 input:ModelCallInput,subject:WholeInputSubject,run:ClaimedAgentRun,
 history:readonly ThreadHistoryMessage[],summary:SummarySourceSnapshot,enabled:boolean,
):ModelCallInput {
 return bindRootAssembly(input,subject,()=>[
  ...history.flatMap((message,index)=>[
   ...(message.id?[{source:{kind:"history" as const,messageId:message.id},sourceSha256:rootSourceHash(message.content),path:["history",index,"content"]}]:[]),
   ...(message.id?(message.attachments??[]).flatMap(attachment=>attachment.attachmentId?[{source:{kind:"attachment" as const,messageId:message.id!,attachmentId:attachment.attachmentId},sourceSha256:rootSourceHash(attachment),path:["history",index,"content"]}]:[]):[]),
   ...(summary.evidence&&message===summary.message?[{source:summary.evidence.source,sourceSha256:summary.evidence.sourceSha256,path:["history",index,"content"]}]:[]),
  ]),
  ...(input.skills??[]).flatMap((skill,index)=>[
   {source:{kind:"skill" as const,versionId:skill.versionId},sourceSha256:rootSourceHash(skill.content),path:["skills",index,"content"]},
   {source:{kind:"skill" as const,versionId:skill.versionId},sourceSha256:rootSourceHash(skill.content),path:["system"]},
  ]),
  ...(run.inputAttachments??[]).flatMap(attachment=>attachment.attachmentId?[{source:{kind:"attachment" as const,messageId:run.inputMessageId,attachmentId:attachment.attachmentId},sourceSha256:rootSourceHash(attachment),path:["user"]}]:[]),
  {source:{kind:"raw-user",messageId:run.inputMessageId},sourceSha256:rootSourceHash(run.inputText),path:["user"]},
  {source:{kind:"pinned-instructions",agentVersionId:run.agentVersionId},sourceSha256:rootSourceHash(run.instructions),path:["system"]},
 ],enabled);
}

/** Preserve the exact synthetic message object so equal user text cannot acquire
 * the persisted/generated summary coordinates during later history transforms. */
export function assembleSummaryHistory(history:readonly ThreadHistoryMessage[],summary:string|null,state:SummarySourceSnapshot):readonly ThreadHistoryMessage[] {
 state.message=summary===null?null:{role:"assistant",content:`[早前对话摘要] ${summary}`};
 return state.message?[state.message,...history]:history;
}
