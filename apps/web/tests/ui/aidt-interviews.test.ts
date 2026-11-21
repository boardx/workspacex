import { describe, expect, it } from "vitest";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import {
  aidtInterviewDirectory, aidtInterviewMaterialKey, archiveAidtInterview, confirmAidtInterviewFinding,
  confirmedAidtInterviewCards, readAidtInterviews, writeAidtInterview, writeAidtInterviewFinding,
  writeAidtInterviewMaterial, writeAidtInterviewTranscript, type AidtInterview,
} from "@/features/aidt/lib/aidt-interviews";

const interview = (number: number): AidtInterview => ({
  version: 1,
  id: `15c7b5e2-9d0e-4b10-bc47-${String(number).padStart(12, "0")}`,
  code: `U${String(number).padStart(2, "0")}`,
  topicRevision: 2,
  topic: "午休点单时如何选择新品？",
  goal: "比较经历",
  original: "最近一次是怎样选择的？",
  adopted: "请回想最近一次看菜单之后的经历。",
  guideConfirmed: true,
  consent: { notes: true, photos: false, audio: false, observedAt: "2026-11-20T04:12:00Z" },
});

describe("AIDT interview entity snapshots", () => {
  it("round-trips ten participants with independent stable IDs and rejects duplicate codes", () => {
    const records = Array.from({ length: 10 }, (_, number) => interview(number + 1));
    const original = records.reduce(writeAidtInterview, emptyAidtUiDrafts()[2]!);
    const persisted = StageDraft.parse(JSON.parse(JSON.stringify(original)));
    const changed = writeAidtInterview(persisted, { ...records[1]!, original: "U02 的补访" });
    expect(aidtInterviewDirectory(changed).map(record => record.id)).toEqual(records.map(record => record.id));
    expect(readAidtInterviews(changed.fields)[0]).toEqual(records[0]);
    expect(readAidtInterviews(changed.fields)[1]?.original).toBe("U02 的补访");
    expect(writeAidtInterview(changed, { ...records[1]!, code: "Ｕ０１" })).toBe(changed);
  });

  it("requires a located checked source for confirmation and keeps historical references after editing or archival", () => {
    const student = interview(1);
    const pending = interview(2);
    const original = writeAidtInterview(writeAidtInterview(emptyAidtUiDrafts()[2]!, student), pending);
    const quote = "我看不出口味差别，就点了原来的。";
    const authored = writeAidtInterviewFinding(original, student, {
      headlineKind: "quote", headline: quote, quote, context: "只说明这次选择。",
    });
    expect(confirmAidtInterviewFinding(authored, student.id, "group-A")).toBe(authored);
    const sourceKey = aidtInterviewMaterialKey(student.id, "raw-transcript");
    const material = JSON.stringify({
      projectId: "group-A", runId: "run", artifactId: "transcript", versionId: "v1", name: "原始转写.txt",
      mime: "text/plain", sha256: "a".repeat(64), bytes: 42,
    });
    const attached = writeAidtInterviewMaterial(authored, student.id, sourceKey, material);
    const checked = writeAidtInterviewTranscript(attached, student.id, { sourceKey, locator: "01:42", text: quote, checked: true });
    expect(confirmAidtInterviewFinding(checked, student.id, "group-B")).toBe(checked);
    const snapshot = StageDraft.parse(confirmAidtInterviewFinding(checked, student.id, "group-A"));
    expect(confirmedAidtInterviewCards(snapshot)).toMatchObject([{ id: student.id, sourceRef: "原始转写.txt · 01:42" }]);
    expect(confirmedAidtInterviewCards(writeAidtInterviewFinding(snapshot, student, { context: "待重新核对" }))).toEqual([]);
    const archived = archiveAidtInterview(snapshot, student.id);
    expect(confirmedAidtInterviewCards(archived)).toEqual([]);
    expect(archived.discoveryCards).toEqual(snapshot.discoveryCards);
    expect(archived.fields[sourceKey]).toBe(material);
    expect(confirmedAidtInterviewCards(snapshot)).toHaveLength(1);
    expect(aidtInterviewDirectory(archived)).toMatchObject([{ id: student.id, archived: true }, { id: pending.id, archived: false }]);
  });
});
