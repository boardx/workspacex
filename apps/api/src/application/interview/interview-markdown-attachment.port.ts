import type { interviewMarkdown } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
export const INTERVIEW_MARKDOWN_ATTACHMENTS=Symbol("InterviewMarkdownAttachments");
export type InterviewMarkdownOriginalAttachment=z.infer<typeof interviewMarkdown.InterviewMarkdownOriginalAttachment>;
export type ImportInterviewMarkdownAttachmentInput={orgId:OrgId;interviewId:string;actorId:string;expectedVersion:number;expectedDocumentVersion:number;filename:string;mime:string;bytes:Uint8Array};
export interface InterviewMarkdownAttachmentRepository {
  commit(input:Omit<ImportInterviewMarkdownAttachmentInput,"filename"|"mime"|"bytes"> & {original:InterviewMarkdownOriginalAttachment;storageRef:string;markdown:string}):Promise<Guarded<InterviewMarkdownOriginalAttachment>>;
}
export class InterviewMarkdownAttachmentError extends Error {
  constructor(readonly code:"FILE_TOO_LARGE"|"FILE_TYPE_REJECTED"|"MIME_MISMATCH"|"ATTACHMENT_EXTRACTION_UNSUPPORTED"|"ATTACHMENT_EXTRACTION_FAILED"|"STORAGE_UNAVAILABLE") {super(code);}
}
