import { z } from "zod";
import { AudioTranscribed } from "./standard-audio-tools";

/** Internal saved AIDT metadata only; no HTTP operation or permission change. */
export const AidtTestResearchPath = z.enum(["offline", "survey", "virtual"]);
export const AIDT_TEST_RESEARCH_LABELS = { offline: "线下访谈", survey: "调查", virtual: "虚拟用户研究" } as const;
const Identifier = z.string().min(1).max(256);
export const AidtTestResearchDocumentPin = z.object({ documentId: Identifier, version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
export const AidtVirtualResearchBindingSchema = z.object({
  interviewId: Identifier, revisionId: Identifier, envelopeVersion: z.number().int().positive(),
  outline: AidtTestResearchDocumentPin, runs: AidtTestResearchDocumentPin, report: AidtTestResearchDocumentPin,
  findings: z.array(z.object({ anchor: Identifier, category: z.enum(["function", "need"]), quote: z.string().min(1).max(500), start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict()).max(24),
}).strict();
export type AidtVirtualResearchBinding = z.infer<typeof AidtVirtualResearchBindingSchema>;
export const AIDT_TEST_VIRTUAL_RESEARCH_PREFIX = "testVirtualResearch:";
export const AidtSyntheticFileAsrKind = z.literal("synthetic-file-asr");
export const AIDT_TEST_SYNTHETIC_ASR_PREFIX = "testSyntheticAsr:";
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
/** A saved software-QA excerpt and genuine native references, never participant consent. */
export const AidtSavedSyntheticAsrSchema = z.object({
  kind: AidtSyntheticFileAsrKind,
  audio: z.object({ artifactId: Identifier, versionId: Identifier, runId: Identifier, sha256: Sha256 }).strict(),
  nativeAudio: z.object({ threadId: Identifier, attachmentId: Identifier, messageId: Identifier, sha256: Sha256 }).strict(),
  transcript: z.object({ artifactId: Identifier, version: z.number().int().positive(), attachmentId: Identifier, producedByRunId: Identifier, producedByStepId: Identifier, name: z.string().min(1).max(300), sha256: Sha256 }).strict(),
  reviewedText: z.string().trim().min(1).max(1700), warnings: AudioTranscribed.shape.warnings,
}).strict().refine(value => value.audio.sha256 === value.nativeAudio.sha256);
export type AidtSavedSyntheticAsr = z.infer<typeof AidtSavedSyntheticAsrSchema>;


/** S2 synthetic-file QA provenance, not participant consent or real interview evidence. */
export const AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX = "interviewSyntheticAsr:";
