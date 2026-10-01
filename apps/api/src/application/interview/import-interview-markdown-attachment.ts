import { createHash,randomUUID } from "node:crypto";
import { interviewMarkdown } from "@repo/contracts";
import type { ObjectStore } from "../artifact/ports";
import type { AttachmentToMarkdownPort } from "../chat/attachment-to-markdown.port";
import { checkAttachmentBytesAndType } from "../../domain/chat/attachment-upload";
import { declaredMimeMatchesBytes } from "../../domain/chat/attachment-mime-sniff";
import { ATTACHMENT_SYNC_EXTRACTION_MAX_BYTES,planExtraction } from "../../domain/chat/attachment-extraction";
import { authorizeDigitalInterview,type GetDigitalInterviewDeps } from "./get-digital-interview";
import { readInterviewMarkdown,type InterviewMarkdownReader } from "./read-interview-markdown";
import { DigitalInterviewWorkflowError } from "./workflow/digital-interview-runtime.port";
import { InterviewMarkdownAttachmentError,type ImportInterviewMarkdownAttachmentInput,type InterviewMarkdownAttachmentRepository } from "./interview-markdown-attachment.port";
import { discloseDecided,isDisclosed } from "../security/permission-filter";
export async function importInterviewMarkdownAttachment(deps:GetDigitalInterviewDeps & {reader:InterviewMarkdownReader;attachments:InterviewMarkdownAttachmentRepository;store:ObjectStore;converter:AttachmentToMarkdownPort},input:ImportInterviewMarkdownAttachmentInput) {
  const viewer={...input,viewerUserId:input.actorId};
  const snapshot=await readInterviewMarkdown(deps,viewer);
  if(snapshot.version!==input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
  const target=snapshot.documents.find(doc=>doc.step==="intake");
  if((target?.version??0)!==input.expectedDocumentVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
  if(target&&!["draft","failed"].includes(snapshot.states.find(state=>state.documentId===target.documentId)?.status??"")) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
  const typeError=checkAttachmentBytesAndType({bytes:input.bytes.byteLength,mime:input.mime});
  if(typeError) throw new InterviewMarkdownAttachmentError(typeError);
  if(!input.bytes.byteLength) throw new InterviewMarkdownAttachmentError("FILE_TYPE_REJECTED");
  if(input.bytes.byteLength>ATTACHMENT_SYNC_EXTRACTION_MAX_BYTES) throw new InterviewMarkdownAttachmentError("FILE_TOO_LARGE");
  if(!declaredMimeMatchesBytes(input.mime,input.bytes)) throw new InterviewMarkdownAttachmentError("MIME_MISMATCH");
  const plan=planExtraction(input.mime);
  let markdown:string;
  if(plan.kind==="passthrough") {
    try {markdown=new TextDecoder("utf-8",{fatal:true}).decode(input.bytes);}catch {throw new InterviewMarkdownAttachmentError("ATTACHMENT_EXTRACTION_FAILED");}
  }
  else if(plan.kind==="convert") {
    const converted=await deps.converter.convert(input.bytes,plan.format);
    if(!converted.ok) throw new InterviewMarkdownAttachmentError(converted.code==="unsupported"?"ATTACHMENT_EXTRACTION_UNSUPPORTED":"ATTACHMENT_EXTRACTION_FAILED");
    markdown=converted.markdown;
  } else throw new InterviewMarkdownAttachmentError("ATTACHMENT_EXTRACTION_UNSUPPORTED");
  if(!markdown.trim()) throw new InterviewMarkdownAttachmentError("ATTACHMENT_EXTRACTION_FAILED");
  await authorizeDigitalInterview(deps,viewer);
  const original=interviewMarkdown.InterviewMarkdownOriginalAttachment.parse({assetId:`asset-${randomUUID()}`,filename:input.filename,mime:input.mime,bytes:input.bytes.byteLength,sha256:createHash("sha256").update(input.bytes).digest("hex")});
  const storageRef=`interview-attachments/${input.orgId}/${input.interviewId}/${original.assetId}`;
  try {await deps.store.putOnce(storageRef,input.bytes,input.mime);} catch {throw new InterviewMarkdownAttachmentError("STORAGE_UNAVAILABLE");}
  const guarded=await deps.attachments.commit({...input,original,storageRef,markdown});
  const renewed=await authorizeDigitalInterview(deps,viewer);
  const disclosed=discloseDecided(guarded,renewed.decision);
  if(!isDisclosed(disclosed)) throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
  return interviewMarkdown.InterviewMarkdownAttachmentResult.parse({source:await readInterviewMarkdown(deps,viewer),original:disclosed.payload});
}
