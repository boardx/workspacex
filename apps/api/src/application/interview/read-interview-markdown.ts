import { interviewMarkdown } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { authorizeDigitalInterview, type GetDigitalInterviewDeps } from "./get-digital-interview";
import { NoInterviewAccessError } from "./errors";
import { DigitalInterviewWorkflowError } from "./workflow/digital-interview-runtime.port";
import type { z } from "zod";

export const INTERVIEW_MARKDOWN_READER = Symbol("InterviewMarkdownReader");
export interface InterviewMarkdownReader {
  saveDraft(input: z.infer<typeof interviewMarkdown.SaveInterviewMarkdownDraft> & {
    orgId: OrgId; interviewId: string; actorId: string;
    step: interviewMarkdown.InterviewMarkdownDocument["step"];
    /** Internal generator metadata; never accepted by the draft-edit HTTP schema. */
    failure?: NonNullable<z.infer<typeof interviewMarkdown.InterviewMarkdownEnvelope>["states"][number]["failure"]>;
    confirm?: boolean;
  }): Promise<void>;
  readCurrent(orgId: OrgId, interviewId: string): Promise<{
    revisionId: string | null;
    version: number;
    documents: Guarded<interviewMarkdown.InterviewMarkdownDocument[]>;
    states: z.infer<typeof interviewMarkdown.InterviewMarkdownEnvelope>["states"];
  } | null>;
}

export async function confirmInterviewMarkdownDraft(
  deps: GetDigitalInterviewDeps & { reader: InterviewMarkdownReader },
  input: z.infer<typeof interviewMarkdown.ConfirmInterviewMarkdown> & {
    orgId: OrgId; viewerUserId: string; interviewId: string;
    step: interviewMarkdown.InterviewMarkdownDocument["step"];
  },
) {
  const current = await readInterviewMarkdown(deps, input);
  if (current.version !== input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
  const document = current.documents.find((item) => item.step === input.step);
  if (!document) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
  if (document.version !== input.expectedDocumentVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
  if (current.states.find((item) => item.documentId === document.documentId)?.status !== "draft") throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
  await deps.reader.saveDraft({ ...input, actorId: input.viewerUserId, markdown: document.markdown, confirm: true });
  return readInterviewMarkdown(deps, input);
}

export async function saveInterviewMarkdownDraft(
  deps: GetDigitalInterviewDeps & { reader: InterviewMarkdownReader },
  input: z.infer<typeof interviewMarkdown.SaveInterviewMarkdownDraft> & {
    orgId: OrgId; viewerUserId: string; interviewId: string;
    step: interviewMarkdown.InterviewMarkdownDocument["step"];
  },
) {
  await authorizeDigitalInterview(deps, input);
  await deps.reader.saveDraft({ ...input, actorId: input.viewerUserId });
  return readInterviewMarkdown(deps, input);
}

export async function readInterviewMarkdown(
  deps: GetDigitalInterviewDeps & { reader: InterviewMarkdownReader },
  input: { orgId: OrgId; viewerUserId: string; interviewId: string },
) {
  await authorizeDigitalInterview(deps, input);
  const source = await deps.reader.readCurrent(input.orgId, input.interviewId);
  if (!source) throw new NoInterviewAccessError(input.interviewId);
  // Recheck visibility after the read; tenant isolation alone is not disclosure authority.
  const authorized = await authorizeDigitalInterview(deps, input);
  const result = discloseDecided(source.documents, authorized.decision);
  if (!isDisclosed(result)) throw new NoInterviewAccessError(input.interviewId);
  return interviewMarkdown.InterviewMarkdownEnvelope.parse({
    interviewId: input.interviewId, revisionId: source.revisionId,
    version: source.version, documents: result.payload, states: source.states,
  });
}
