/**
 * F90 —— 现场三栏外壳 + 状态条 + 提纲进度人工勾选（AI 不得写完成态）
 * （uc-6-4 R3，AC2）。
 *
 * 纯单元测试，不连 Postgres（issue #74：本地只保证纯测试与 typecheck）。
 *
 * ## 这个文件要证的事，以及反证
 *
 * 1. **人能写**：`viewerActorKind: "human"` 对一个存在的段落调 `setOutlineSectionStatus`
 *    成功落库，`status` 真的从 `null` 变成 `"done"`/`"deferred"`，`writerOrigin` 恒
 *    `"human"`——不是「调用成功但什么都没变」。
 * 2. **AI 恒被拒（核心反证）**：`viewerActorKind: "agent"` 调用同一个用例，对同一个
 *    存在的段落，被 `AiWriteForbiddenError`（契约码 `AI_WRITE_FORBIDDEN`）拒绝，且
 *    落库的 `status` 保持不变（仍是调用前的值）——不是「先写后端再判权限」，门禁
 *    在任何存储写入之前。反证：若实现只在 HTTP 层挡 agent、应用层本身来者不拒，
 *    这条测试会因为直接绕过 HTTP 调用应用层函数而当场失败。
 * 3. **门禁不看请求体自称**：命令的类型里根本没有 `origin`/`writerOrigin` 输入字段——
 *    只有 `viewerActorKind`，且它的类型是 `"human" | "agent"` 而非任意字符串，
 *    调用方（HTTP 层/记录 agent 适配层）判定这一位，客户端无法在请求体里为自己
 *    正名。
 * 4. **AI 被拒不因为段落不存在而“顺便”通过**：对一个真实存在的 sectionId 也一样拒绝
 *    ——不是「反正查不到就报错」的假阳性,是权限先于存在性判断。
 * 5. **并发反证**：对已不存在的 `sectionId`（大纲被整体重新生成替换掉）调用，
 *    `viewerActorKind: "human"` 也被拒绝（`CONCURRENT_MODIFICATION`），不静默套错段落。
 */
import { describe, expect, it } from "vitest";
import type { OutlineSectionDraft } from "../../src/domain/interview/outline";
import {
  setOutlineSectionStatus,
  type SetOutlineSectionStatusCommand,
} from "../../src/application/interview/set-outline-section-status";
import { AiWriteForbiddenError, OutlineSectionConcurrentModificationError } from "../../src/application/interview/errors";
import { InMemoryOutlineRepository } from "../support/outline-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-f90-outline-status");

function section(objective: string, openers: readonly string[], minutes: number, order: number): OutlineSectionDraft {
  return { objective, openers, minutes, order };
}

function harness() {
  const outlines = new InMemoryOutlineRepository();
  return { outlines };
}

async function seedOutline(deps: ReturnType<typeof harness>, sections: OutlineSectionDraft[]) {
  return deps.outlines.create({
    orgId: ORG,
    outlineId: "outline-1",
    interviewId: "itv-1",
    sections,
    generatedBy: "u-researcher",
  });
}

function baseCommand(overrides: Partial<SetOutlineSectionStatusCommand> = {}): SetOutlineSectionStatusCommand {
  return {
    orgId: ORG,
    outlineId: "outline-1",
    sectionId: "outline-1-sec-0",
    status: "done",
    viewerActorKind: "human",
    ...overrides,
  };
}

describe("F90 · setOutlineSectionStatus —— 提纲逐段人工勾选，AI 不得写完成态", () => {
  it("人（human）标记完成：落库 status 从 null 变为 done，writerOrigin 恒 human", async () => {
    const deps = harness();
    await seedOutline(deps, [section("目标", ["问法一", "问法二"], 10, 0)]);

    const before = await deps.outlines.getById(ORG, "outline-1");
    expect(before?.sections[0]!.status).toBeNull();

    const result = await setOutlineSectionStatus({ outlines: deps.outlines }, baseCommand({ status: "done" }));

    expect(result).toEqual({
      outlineId: "outline-1",
      sectionId: "outline-1-sec-0",
      status: "done",
      writerOrigin: "human",
    });

    const after = await deps.outlines.getById(ORG, "outline-1");
    expect(after?.sections[0]!.status).toBe("done");
  });

  it("人（human）标记延后：同一段可以标 deferred", async () => {
    const deps = harness();
    await seedOutline(deps, [section("目标", ["问法一", "问法二"], 10, 0)]);

    const result = await setOutlineSectionStatus({ outlines: deps.outlines }, baseCommand({ status: "deferred" }));
    expect(result.status).toBe("deferred");

    const after = await deps.outlines.getById(ORG, "outline-1");
    expect(after?.sections[0]!.status).toBe("deferred");
  });

  it("AI（agent）不得写完成态：AI_WRITE_FORBIDDEN，且被拒绝的调用不改变落库状态", async () => {
    const deps = harness();
    await seedOutline(deps, [section("目标", ["问法一", "问法二"], 10, 0)]);

    await expect(
      setOutlineSectionStatus(
        { outlines: deps.outlines },
        baseCommand({ status: "done", viewerActorKind: "agent" }),
      ),
    ).rejects.toThrow(AiWriteForbiddenError);

    // 反证：被拒绝的写入没有偷偷落库——这段的 status 仍是调用前的 null。
    const after = await deps.outlines.getById(ORG, "outline-1");
    expect(after?.sections[0]!.status).toBeNull();
  });

  it("AI 的拒绝携带契约码 AI_WRITE_FORBIDDEN", async () => {
    const deps = harness();
    await seedOutline(deps, [section("目标", ["问法一", "问法二"], 10, 0)]);

    try {
      await setOutlineSectionStatus(
        { outlines: deps.outlines },
        baseCommand({ viewerActorKind: "agent" }),
      );
      expect.unreachable("应当抛出 AiWriteForbiddenError");
    } catch (e) {
      expect(e).toBeInstanceOf(AiWriteForbiddenError);
      expect((e as AiWriteForbiddenError).code).toBe("AI_WRITE_FORBIDDEN");
    }
  });

  it("AI 对存在的段落一样被拒——不是因为段落找不到才报错（权限先于存在性判断）", async () => {
    const deps = harness();
    await seedOutline(deps, [section("目标", ["问法一", "问法二"], 10, 0)]);

    // 即使先人工写过一次（段落确实存在、确实可写），AI 后续调用仍然被拒。
    await setOutlineSectionStatus({ outlines: deps.outlines }, baseCommand({ status: "done" }));

    await expect(
      setOutlineSectionStatus(
        { outlines: deps.outlines },
        baseCommand({ status: "deferred", viewerActorKind: "agent" }),
      ),
    ).rejects.toThrow(AiWriteForbiddenError);

    // 且 AI 那次被拒的调用没有把已经人工标好的 done 悄悄改成 deferred。
    const after = await deps.outlines.getById(ORG, "outline-1");
    expect(after?.sections[0]!.status).toBe("done");
  });

  it("人对已不存在的 sectionId（大纲被整体重新生成替换）被拒绝，不静默套错段落", async () => {
    const deps = harness();
    await seedOutline(deps, [section("目标", ["问法一", "问法二"], 10, 0)]);

    await expect(
      setOutlineSectionStatus(
        { outlines: deps.outlines },
        baseCommand({ sectionId: "outline-1-sec-99" }),
      ),
    ).rejects.toThrow(OutlineSectionConcurrentModificationError);
  });

  it("对不存在的 outlineId 同样被拒绝", async () => {
    const deps = harness();
    await expect(
      setOutlineSectionStatus(
        { outlines: deps.outlines },
        baseCommand({ outlineId: "outline-does-not-exist" }),
      ),
    ).rejects.toThrow(OutlineSectionConcurrentModificationError);
  });
});
