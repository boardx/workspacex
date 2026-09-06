import type { RestorableInterrupt } from "@repo/contracts/agent-interrupts";
import type { ModelCallCompletion } from "./ports";
export type ReconciledRemoteRun =
 | {kind:"running"}
 | {kind:"success";completion:ModelCallCompletion}
 | {kind:"paused"|"cancelled"}
 | {kind:"approval";toolName:string;argsSummary:string|null;interrupt?:RestorableInterrupt}
 | {kind:"failed";diagnostic:string}
 | {kind:"uncertain";diagnostic:string};
export interface RemoteRunReconciler { reconcileExistingRun(threadId:string,remoteRunId:string,logicalRunId?:string,remoteThreadId?:string,runtimeProfile?:"legacy"|"native-v1"):Promise<ReconciledRemoteRun> }
export const RUN_RECOVERY=Symbol("RunRecovery");
/** Public recovery explanation; transport details stay outside the user interface. */
export function recoveryExplanation(diagnostic:string):string {
  if(diagnostic==="output_execution_requires_review_no_replay")return "文件处理可能已经执行，为避免重复操作，请核对原任务结果。";
  if(diagnostic==="remote_run_id_not_recorded")return "任务提交结果尚未确认，系统不会重复执行。";
  if(diagnostic.includes("checkpoint")||diagnostic.includes("identity"))return "暂时无法确认这条任务的保存进度，系统不会重放已执行的操作。";
  if(diagnostic==="provider_recovery_unsupported")return "此执行服务暂不支持自动恢复，请核对原任务结果。";
  if(diagnostic==="remote_error"||diagnostic==="remote_timeout")return "执行服务报告任务未完成，请核对已产生的结果。";
  return "暂时无法确认执行状态，正在重试读取原任务。";
}
