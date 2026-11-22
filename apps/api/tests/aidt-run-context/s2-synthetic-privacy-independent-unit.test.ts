import { expect, it } from "vitest";
import { SharedStage } from "@repo/contracts/aidt-stages";
import { AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX, AidtSavedSyntheticAsrSchema } from "@repo/contracts/aidt-test-research";
import { checkedInterviewExcerpt, interviewSyntheticAsrContext, projectInterviewSkillDraft } from "../../src/application/aidt-stages/interview-skill-draft";
import { aidtSavedEntityContext } from "../../src/application/aidt-stages/entity-thread";

const id = "15c7b5e2-9d0e-4b10-bc47-000000000001";
const sibling = "15c7b5e2-9d0e-4b10-bc47-000000000002";
const projectId = "qa-project";
const body = "SYNTHETIC_PRIVATE_TRANSCRIPT_上次她先看口味再考虑时间";
const context = "SYNTHETIC_PRIVATE_FINDING_尚未验证的解释";
const key = `interviewMaterial:${id}:qa-audio`;
const marker = AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + id;
const pin = AidtSavedSyntheticAsrSchema.parse({ kind: "synthetic-file-asr",
  audio: { artifactId: "qa-audio", versionId: "qa-audio-v1", runId: "qa-upload", sha256: "a".repeat(64) },
  nativeAudio: { threadId: "qa-thread", attachmentId: "qa-attachment", messageId: "qa-message", sha256: "a".repeat(64) },
  transcript: { artifactId: "qa-transcript", version: 2, attachmentId: "qa-transcript-attachment", producedByRunId: "qa-run", producedByStepId: "qa-step", name: "qa-transcript.json", sha256: "b".repeat(64) },
  reviewedText: body, warnings: ["speaker_identity_unavailable"] });

function fixture() {
  return SharedStage.parse({ sourceStageRevisions: [], projectId, stageId: 2, revision: 3, updatedAt: "2026-11-22T06:50:00Z", updatedBy: "qa-member",
    content: { schemaVersion: 1, draft: { selectedIdeaId: "", fields: {
      [`interviewRecord:${id}`]: JSON.stringify({ id, version: 1, code: "U01", topic: "理解选择过程", goal: "了解故事", original: "请说说上次经过？", adopted: "请说说实际经过？", guideConfirmed: true, consent: { notes: true, audio: true, photos: false } }),
      [key]: JSON.stringify({ projectId, artifactId: pin.audio.artifactId, versionId: pin.audio.versionId, runId: pin.audio.runId, sha256: pin.audio.sha256, name: "qa-synthetic.wav", mime: "audio/wav" }),
      [`interviewTranscript:${id}`]: JSON.stringify({ checked: true, text: body, locator: "合成软件测试 ASR V2", sourceKey: key }),
      [marker]: JSON.stringify(pin),
      [`interviewInterpretation:${id}`]: context,
    }, ideas: [], discoveryCards: [{ id, participantCode: "U01", headlineKind: "quote", headline: body, quote: body, context, sourceRef: "qa-synthetic.wav · 合成软件测试 ASR V2", photoRef: "" }] },
    } });
}

function expectOmitted(stage = fixture(), entityId = id) {
  expect(checkedInterviewExcerpt(stage.content.draft.fields, entityId, stage.projectId)).toBeUndefined();
  const result = aidtSavedEntityContext(stage, entityId);
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(body);
  expect(serialized).not.toContain(context);
  expect(serialized).not.toContain("qa-synthetic.wav");
  expect("checkedExcerpt" in result ? result.checkedExcerpt : undefined).toBeUndefined();
  expect("finding" in result ? result.finding : undefined).toBeUndefined();
  return serialized;
}

it("keeps valid saved synthetic ASR out of real excerpts and teaching findings, explicitly without re-verification", () => {
  const stage = fixture();
  expect(interviewSyntheticAsrContext(stage.content.draft.fields, id, projectId)?.status).toBe("matching-saved-source-not-reverified");
  expect(expectOmitted(stage)).toContain("不是真人访谈");
});

it.each(["", "{broken", "{}"])("never promotes a damaged marker %j to real participant evidence", raw => {
  const stage = fixture(); stage.content.draft.fields[marker] = raw;
  expect(interviewSyntheticAsrContext(stage.content.draft.fields, id, projectId)?.status).toBe("unavailable-or-mismatched");
  expect(expectOmitted(stage)).toContain("synthetic-file-asr");
});

it("retains the synthetic boundary when the marker is lost but its ASR locator remains", () => {
  const stage = fixture(); delete stage.content.draft.fields[marker];
  expect(expectOmitted(stage)).toContain("synthetic-file-asr");
});

it.each(["notes", "audio"])("revoked %s consent cannot expose synthetic body or matching source", permission => {
  const stage = fixture(), fields = stage.content.draft.fields;
  const record = JSON.parse(fields[`interviewRecord:${id}`]!); record.consent[permission] = false;
  fields[`interviewRecord:${id}`] = JSON.stringify(record);
  expect(interviewSyntheticAsrContext(fields, id, projectId)?.status).toBe("unavailable-or-mismatched");
  expectOmitted(stage);
});

it.each(["project", "entity", "artifact", "version", "run", "hash", "locator"])("refuses a %s mismatch while keeping synthetic provenance", mismatch => {
  const stage = fixture(), fields = stage.content.draft.fields;
  const material = JSON.parse(fields[key]!);
  if (mismatch === "project") material.projectId = "foreign-project";
  if (mismatch === "artifact") material.artifactId = "foreign-artifact";
  if (mismatch === "version") material.versionId = "foreign-version";
  if (mismatch === "run") material.runId = "foreign-run";
  if (mismatch === "hash") material.sha256 = "c".repeat(64);
  fields[key] = JSON.stringify(material);
  if (mismatch === "entity" || mismatch === "locator") {
    const transcript = JSON.parse(fields[`interviewTranscript:${id}`]!);
    if (mismatch === "entity") transcript.sourceKey = `interviewMaterial:${sibling}:qa-audio`;
    else transcript.locator = "合成软件测试 ASR V3";
    fields[`interviewTranscript:${id}`] = JSON.stringify(transcript);
  }
  expect(interviewSyntheticAsrContext(fields, id, projectId)?.status).toBe("unavailable-or-mismatched");
  expectOmitted(stage);
});

it("does not let an assistant quote a synthetic transcript into a participant quotation", () => {
  const stage = fixture(); stage.content.draft.discoveryCards = [];
  const result = projectInterviewSkillDraft(stage.content.draft, id, { projectId, user: "请整理发现", messageId: "qa-new-turn",
    assistant: `### 人物发现卡（草稿）\n受访者原话：${body}` });
  expect(result).toBeNull();
});

it("does not borrow the sibling entity source and keeps the normal checked excerpt control working", () => {
  const stage = fixture();
  expectOmitted(stage, sibling);
  delete stage.content.draft.fields[marker];
  const transcript = JSON.parse(stage.content.draft.fields[`interviewTranscript:${id}`]!);
  transcript.locator = "00:03";
  stage.content.draft.fields[`interviewTranscript:${id}`] = JSON.stringify(transcript);
  expect(checkedInterviewExcerpt(stage.content.draft.fields, id, projectId)).toEqual({ text: body, locator: "00:03", name: "qa-synthetic.wav" });
});
