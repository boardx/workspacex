import type { interviewMarkdown } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
export const INTERVIEW_MARKDOWN_EXECUTION = Symbol("InterviewMarkdownExecution");
export type MarkdownExecutionActor = { orgId:OrgId; interviewId:string; actorId:string };
export type MarkdownExecutionInput = MarkdownExecutionActor & z.infer<typeof interviewMarkdown.ExecuteInterviewMarkdown>;
export interface InterviewMarkdownExecutionRuntime {
  execute(input:MarkdownExecutionInput): Promise<z.infer<typeof interviewMarkdown.InterviewMarkdownEnvelope>>;
}
export interface InterviewMarkdownExecutionStore {
  control(input:MarkdownExecutionInput): Promise<void>;
  claim(input:MarkdownExecutionActor): Promise<null | {
    claimId:string; expertId:string;
    content:Guarded<{partial:string;sources:interviewMarkdown.InterviewMarkdownDocument[]}>;
  }>;
  finish(input:MarkdownExecutionActor & {claimId:string;markdown:string;failed:boolean}):Promise<void>;
}
