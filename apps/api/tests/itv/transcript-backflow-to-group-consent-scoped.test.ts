/**
 * F99 —— 转写自动回流到本组，受同意位约束（uc-6-7 R3 步骤 8 / O-05，V2/V8/A1）。
 *
 * 断言口径逐字对齐 issue #290：
 * · V2：某对象的转写自动关联到其所属组，关联记录含来源资源与版本（固定快照）。
 * · V8：`交给 AI 分析 = 否` 的对象，回流内容不参与本组推演模板自动填充（`quotesOnly`）。
 * · A1：未归组对象不产生回流目标（`SUBJECT_NOT_GROUPED`）。
 *
 * 纯应用层单测（fakes，不连 Postgres）——见 issue #74。
 */
import { describe, expect, it } from "vitest";
import { routeTranscriptToGroup } from "../../src/application/interview/route-transcript-to-group";
import { SubjectNotGroupedError } from "../../src/application/interview/errors";
import type {
  ConsentBitsForRouting,
  SubjectGroupFacts,
  SubjectGroupLookup,
  TranscriptArtifactRef,
  TranscriptArtifactSource,
} from "../../src/application/interview/transcript-backflow-ports";
import type { ConsentBits } from "../../src/domain/interview/subject";
import { toOrgId, type OrgId } from "../../src/domain/org-id";

process.env.KERNEL_QUIET = "1";

const ORG = toOrgId("org-f99-backflow");
const INTERVIEW = "itv-f99-session";
const GROUPED_SUBJECT = "subj-f99-grouped";
const UNGROUPED_SUBJECT = "subj-f99-ungrouped";
const GROUP_ID = "group-f99-1";

class FakeSubjectGroupLookup implements SubjectGroupLookup {
  constructor(private readonly rows: Map<string, SubjectGroupFacts>) {}
  async find(_orgId: OrgId, subjectId: string): Promise<SubjectGroupFacts | null> {
    return this.rows.get(subjectId) ?? null;
  }
}

class FakeConsentBitsForRouting implements ConsentBitsForRouting {
  constructor(private readonly bits: Map<string, ConsentBits | null>) {}
  async latestBits(_orgId: OrgId, _interviewId: string, subjectId: string): Promise<ConsentBits | null> {
    return this.bits.get(subjectId) ?? null;
  }
}

class FakeTranscriptArtifactSource implements TranscriptArtifactSource {
  constructor(private readonly refs: Map<string, readonly TranscriptArtifactRef[]>) {}
  async refsFor(_orgId: OrgId, _interviewId: string, subjectId: string): Promise<readonly TranscriptArtifactRef[]> {
    return this.refs.get(subjectId) ?? [];
  }
}

function setup(opts: {
  groups: Record<string, string | null>;
  bits: Record<string, ConsentBits | null>;
  refs: Record<string, readonly TranscriptArtifactRef[]>;
}) {
  const groupRows = new Map<string, SubjectGroupFacts>();
  for (const [subjectId, groupId] of Object.entries(opts.groups)) {
    groupRows.set(subjectId, { subjectId, groupId });
  }
  return {
    groups: new FakeSubjectGroupLookup(groupRows),
    consent: new FakeConsentBitsForRouting(new Map(Object.entries(opts.bits))),
    artifacts: new FakeTranscriptArtifactSource(new Map(Object.entries(opts.refs))),
  };
}

describe("F99 — 转写自动回流到本组", () => {
  it("已授权对象：回流关联到所属组，携带固定快照引用，quotesOnly=false", async () => {
    const deps = setup({
      groups: { [GROUPED_SUBJECT]: GROUP_ID },
      bits: { [GROUPED_SUBJECT]: { record: true, transcript: true, ai_analysis: true, attribution: true } },
      refs: {
        [GROUPED_SUBJECT]: [
          { artifactId: "art-1", versionId: "ver-1" },
          { artifactId: "art-2", versionId: "ver-2" },
        ],
      },
    });

    const result = await routeTranscriptToGroup(deps, {
      orgId: ORG,
      interviewId: INTERVIEW,
      subjectId: GROUPED_SUBJECT,
    });

    expect(result.groupId).toBe(GROUP_ID);
    expect(result.artifactRefs).toEqual([
      { artifactId: "art-1", versionId: "ver-1" },
      { artifactId: "art-2", versionId: "ver-2" },
    ]);
    expect(result.quotesOnly).toBe(false);
  });

  it("拒绝 AI 分析的对象：仍回流到本组，但 quotesOnly=true（AC8/V8）", async () => {
    const deps = setup({
      groups: { [GROUPED_SUBJECT]: GROUP_ID },
      bits: { [GROUPED_SUBJECT]: { record: true, transcript: true, ai_analysis: false, attribution: false } },
      refs: { [GROUPED_SUBJECT]: [{ artifactId: "art-3", versionId: "ver-3" }] },
    });

    const result = await routeTranscriptToGroup(deps, {
      orgId: ORG,
      interviewId: INTERVIEW,
      subjectId: GROUPED_SUBJECT,
    });

    expect(result.groupId).toBe(GROUP_ID);
    expect(result.quotesOnly).toBe(true);
  });

  it("尚无任何同意提交：默认按 quotesOnly=true 处理（保守默认，而非默认放行）", async () => {
    const deps = setup({
      groups: { [GROUPED_SUBJECT]: GROUP_ID },
      bits: {},
      refs: { [GROUPED_SUBJECT]: [] },
    });

    const result = await routeTranscriptToGroup(deps, {
      orgId: ORG,
      interviewId: INTERVIEW,
      subjectId: GROUPED_SUBJECT,
    });

    expect(result.quotesOnly).toBe(true);
  });

  it("未归组对象：回流目标缺失，抛 SubjectNotGroupedError（A1）", async () => {
    const deps = setup({
      groups: { [UNGROUPED_SUBJECT]: null },
      bits: {},
      refs: {},
    });

    await expect(
      routeTranscriptToGroup(deps, { orgId: ORG, interviewId: INTERVIEW, subjectId: UNGROUPED_SUBJECT }),
    ).rejects.toThrow(SubjectNotGroupedError);
  });

  it("未知对象：同样按未归组处理，不产生回流（不区分\"不存在\"与\"未归组\"，两者都没有回流目标）", async () => {
    const deps = setup({ groups: {}, bits: {}, refs: {} });

    await expect(
      routeTranscriptToGroup(deps, { orgId: ORG, interviewId: INTERVIEW, subjectId: "subj-unknown" }),
    ).rejects.toThrow(SubjectNotGroupedError);
  });
});
