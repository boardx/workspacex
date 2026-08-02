/**
 * F92 —— 研究问题(RQ)五态覆盖度（由你确认）（uc-6-4 R3 步骤7，AC1/AC2）。
 *
 * 纯单元测试，不连 Postgres（issue #74：本地只保证纯测试与 typecheck）。
 *
 * ## 这个文件要证的事，以及反证
 *
 * 1. **四取值都能由人写入**：`covered` / `partial` / `uncovered` / `not_applicable`
 *    逐一写入都成功落库,不是"看起来支持四值，实际上只接受三个"。
 * 2. **`not_applicable` 与 `uncovered` 是两个不同的落库值，不可互相坍缩**——
 *    写 `not_applicable` 之后落库读出来必须精确是 `"not_applicable"`，不是
 *    `"uncovered"`（反证：若实现内部把第四态并进 `uncovered` 分支，这里会读出
 *    错误的值）。
 * 3. **AI 恒被拒（核心反证）**：`viewerActorKind: "agent"` 调用同一个用例，对同一个
 *    存在的 RQ，被 `RqCoverageAiWriteForbiddenError`（契约码 `AI_WRITE_FORBIDDEN`）拒绝，
 *    且落库的 `value` 保持不变——门禁在任何存储写入之前，不是先写后端再判权限。
 * 4. **门禁不看请求体自称**：命令类型里没有 `origin`/`writerOrigin` 输入字段，只有
 *    `viewerActorKind: "human" | "agent"`。
 * 5. **AI 被拒不因为 RQ 不存在而"顺便"通过**：对真实存在的 rqId 也一样拒绝——权限
 *    先于存在性判断。
 * 6. **并发反证**：对不存在的 rqId / interviewId，人工写入也被拒绝
 *    （`CONCURRENT_MODIFICATION`），不静默套错 RQ。
 * 7. **结束汇总统计（AC1）**：`summarizeRqCoverage` 把 `not_applicable` 独立计数，
 *    不并入 `uncoveredCount`——若合并计数会让"未覆盖"的数字失真。
 */
import { describe, expect, it } from "vitest";
import {
  RqCoverageAiWriteForbiddenError,
  RqCoverageConcurrentModificationError,
} from "../../src/application/interview/errors";
import {
  setRqCoverageStatus,
  type SetRqCoverageStatusCommand,
} from "../../src/application/interview/set-rq-coverage-status";
import { InMemoryRqCoverageRepository } from "../support/rq-coverage-fakes";
import { toOrgId } from "../../src/domain/org-id";
import { summarizeRqCoverage, type RqCoverageValueName } from "../../src/domain/interview/rq-coverage";

const ORG = toOrgId("org-f92-rq-coverage");
const INTERVIEW_ID = "itv-1";

const FIVE_RQ_DRAFTS = [
  { rqId: "rq-1", label: "RQ1", order: 0 },
  { rqId: "rq-2", label: "RQ2", order: 1 },
  { rqId: "rq-3", label: "RQ3", order: 2 },
  { rqId: "rq-4", label: "RQ4", order: 3 },
  { rqId: "rq-5", label: "RQ5", order: 4 },
];

function harness() {
  const rqCoverage = new InMemoryRqCoverageRepository();
  rqCoverage.seed(INTERVIEW_ID, FIVE_RQ_DRAFTS);
  return { rqCoverage };
}

function baseCommand(overrides: Partial<SetRqCoverageStatusCommand> = {}): SetRqCoverageStatusCommand {
  return {
    orgId: ORG,
    interviewId: INTERVIEW_ID,
    rqId: "rq-1",
    value: "covered",
    viewerActorKind: "human",
    ...overrides,
  };
}

describe("F92 · setRqCoverageStatus —— RQ 五态覆盖度，人写，AI 恒被拒", () => {
  it.each<RqCoverageValueName>(["covered", "partial", "uncovered", "not_applicable"])(
    "人（human）写入取值 %s：落库精确等于该值",
    async (value) => {
      const deps = harness();
      const result = await setRqCoverageStatus(deps, baseCommand({ value }));

      expect(result).toEqual({ rqId: "rq-1", value, writerOrigin: "human" });

      const after = await deps.rqCoverage.listByInterview(ORG, INTERVIEW_ID);
      expect(after.find((r) => r.rqId === "rq-1")?.value).toBe(value);
    },
  );

  it("`not_applicable` 与 `uncovered` 落库为两个不同的值，不可互相坍缩", async () => {
    const deps = harness();
    await setRqCoverageStatus(deps, baseCommand({ rqId: "rq-4", value: "uncovered" }));
    await setRqCoverageStatus(deps, baseCommand({ rqId: "rq-5", value: "not_applicable" }));

    const after = await deps.rqCoverage.listByInterview(ORG, INTERVIEW_ID);
    expect(after.find((r) => r.rqId === "rq-4")?.value).toBe("uncovered");
    expect(after.find((r) => r.rqId === "rq-5")?.value).toBe("not_applicable");
    // 反证：两者不相等——若实现把第四态坍缩进 uncovered，这个断言会失败。
    expect(after.find((r) => r.rqId === "rq-4")?.value).not.toBe(
      after.find((r) => r.rqId === "rq-5")?.value,
    );
  });

  it("AI（agent）不得写覆盖态：AI_WRITE_FORBIDDEN，且被拒绝的调用不改变落库状态", async () => {
    const deps = harness();

    await expect(
      setRqCoverageStatus(deps, baseCommand({ viewerActorKind: "agent" })),
    ).rejects.toThrow(RqCoverageAiWriteForbiddenError);

    const after = await deps.rqCoverage.listByInterview(ORG, INTERVIEW_ID);
    expect(after.find((r) => r.rqId === "rq-1")?.value).toBeNull();
  });

  it("AI 的拒绝携带契约码 AI_WRITE_FORBIDDEN", async () => {
    const deps = harness();
    try {
      await setRqCoverageStatus(deps, baseCommand({ viewerActorKind: "agent" }));
      expect.unreachable("应当抛出 RqCoverageAiWriteForbiddenError");
    } catch (e) {
      expect(e).toBeInstanceOf(RqCoverageAiWriteForbiddenError);
      expect((e as RqCoverageAiWriteForbiddenError).code).toBe("AI_WRITE_FORBIDDEN");
    }
  });

  it("AI 对存在的 RQ 一样被拒——不是因为 RQ 找不到才报错（权限先于存在性判断）", async () => {
    const deps = harness();
    await setRqCoverageStatus(deps, baseCommand({ value: "covered" }));

    await expect(
      setRqCoverageStatus(deps, baseCommand({ value: "uncovered", viewerActorKind: "agent" })),
    ).rejects.toThrow(RqCoverageAiWriteForbiddenError);

    const after = await deps.rqCoverage.listByInterview(ORG, INTERVIEW_ID);
    expect(after.find((r) => r.rqId === "rq-1")?.value).toBe("covered");
  });

  it("人对不存在的 rqId（RQ 清单被重新生成替换）被拒绝，不静默套错 RQ", async () => {
    const deps = harness();
    await expect(
      setRqCoverageStatus(deps, baseCommand({ rqId: "rq-does-not-exist" })),
    ).rejects.toThrow(RqCoverageConcurrentModificationError);
  });

  it("对不存在的 interviewId 同样被拒绝", async () => {
    const deps = harness();
    await expect(
      setRqCoverageStatus(deps, baseCommand({ interviewId: "itv-does-not-exist" })),
    ).rejects.toThrow(RqCoverageConcurrentModificationError);
  });

  it("AC1：结束汇总把 not_applicable 独立计数，不并入 uncoveredCount", () => {
    const summary = summarizeRqCoverage([
      { rqId: "rq-1", label: "RQ1", order: 0, value: "covered" },
      { rqId: "rq-2", label: "RQ2", order: 1, value: "covered" },
      { rqId: "rq-3", label: "RQ3", order: 2, value: "partial" },
      { rqId: "rq-4", label: "RQ4", order: 3, value: "uncovered" },
      { rqId: "rq-5", label: "RQ5", order: 4, value: "not_applicable" },
    ]);

    expect(summary).toEqual(
      expect.objectContaining({
        total: 5,
        coveredCount: 2,
        partialCount: 1,
        uncoveredCount: 1,
        notApplicableCount: 1,
      }),
    );
  });
});
