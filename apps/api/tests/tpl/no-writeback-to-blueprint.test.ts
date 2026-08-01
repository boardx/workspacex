/**
 * F28 · **不回写蓝本**（`uc-2-2#R6` / 依赖 F23 `apply-blueprint`）。
 *
 * `snapshot-binding.test.ts`（F23 自己的测试）已经证明「命令里没有 content 字段」——
 * 那是**正向**：改的是套用这一侧，看蓝本那一侧的输入里带没带内容。本文件补三条
 * 它没证的方向，因为只做正向会放过一整类坏实现：
 *
 *   ① **反向 / 决定性**：`applyBlueprintUseCase` 在执行期间**从未读取** `resolvedVersion.content`
 *      —— 不是「读了但没往命令里塞」，是从头到尾没有一次属性访问。用 Proxy 在
 *      `content` 上安一个读陷阱，读一次就抛错；用例正常跑完 ⇒ 陷阱从未触发。
 *      这条比「命令没有 content 字段」严格得多：一个「读了 content 算出点什么、
 *      再悄悄不放进命令」的实现，正向断言看不出来，这条能看出来。
 *   ② **结构**：`ApplyBlueprintRepository` 的方法名集合恒等于 `{apply}`——没有第二个
 *      能把蓝本内容写回任何地方的方法名（同 F63 `TEMPLATE_PORTS_ALLOWED_METHODS` 的白名单идиом）。
 *   ③ **契约级旁路清单**：`TEMPLATES_FORBIDDEN_ROUTES` 里挂着「不存在的路由」——
 *      交付物是一条断言它不存在的测试，不是一个接口（契约原文）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { templates } from "@repo/contracts";
import { applyBlueprintUseCase } from "../../src/application/templates/apply-blueprint";
import type { ApplyBlueprintCommand, ApplyBlueprintRepository, AppliedProject } from "../../src/application/templates/apply-blueprint-ports";
import type { BlueprintVersion } from "../../src/domain/templates/blueprint-version";
import { designFacetKeys } from "../../src/domain/templates/design-facet-table";
import { toOrgId } from "../../src/domain/org-id";

const PORTS_SRC = fileURLToPath(
  new URL("../../src/application/templates/apply-blueprint-ports.ts", import.meta.url),
);

function versionWithTrappedContent(reads: string[]): BlueprintVersion {
  const base: Omit<BlueprintVersion, "content"> = {
    id: "v-1",
    blueprintId: "bp-1",
    versionNumber: 1,
    changedDesignFacetKeys: ["flow-agenda"],
    rolledBackFrom: null,
    state: "published",
  };
  return new Proxy(base as unknown as BlueprintVersion, {
    get(target, prop, receiver) {
      if (prop === "content") {
        reads.push("content");
        throw new Error("resolvedVersion.content 被读取了——套用蓝本不该看内容,只该转发引用");
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

const baseInput = {
  orgId: toOrgId("org-1"),
  actorId: "u-1",
  actorOrgRole: "lead" as const,
  blueprintId: "bp-1",
  blueprintExists: true,
  visibleToActor: true,
  filledFacetKeys: designFacetKeys(),
  tier: "two-day" as const,
  projectName: "新项目",
  idempotencyKey: "idem-1",
};

describe("① 反向：套用蓝本期间从未读取 resolvedVersion.content（Proxy 读陷阱）", () => {
  it("正常一次套用跑完，陷阱一次都没触发", async () => {
    const reads: string[] = [];
    const version = versionWithTrappedContent(reads);
    let seen: ApplyBlueprintCommand | null = null;
    const repo: ApplyBlueprintRepository = {
      async apply(cmd) {
        seen = cmd;
        const out: AppliedProject = {
          projectId: "p-1",
          blueprintVersionId: cmd.blueprintVersionId,
          initialized: cmd.initialized,
          created: true,
        };
        return out;
      },
    };

    const out = await applyBlueprintUseCase({ repo }, { ...baseInput, resolvedVersion: version });

    expect(reads).toEqual([]);
    expect(out.blueprintVersionId).toBe("v-1");
    // 命令里带的是引用(id)，不是内容——即便陷阱没抛，这条也该恒真。
    expect(seen).not.toBeNull();
    expect(Object.keys(seen!)).not.toContain("content");
    expect((seen as unknown as Record<string, unknown>)["blueprintVersionId"]).toBe("v-1");
  });

  it("即使调用方在版本对象上放的是一个会抛的 getter，套用仍然成功——因为没人碰它", async () => {
    const reads: string[] = [];
    const version = versionWithTrappedContent(reads);
    const repo: ApplyBlueprintRepository = {
      async apply(cmd) {
        return { projectId: "p-2", blueprintVersionId: cmd.blueprintVersionId, initialized: cmd.initialized, created: true };
      },
    };

    await expect(
      applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "idem-2", resolvedVersion: version }),
    ).resolves.toMatchObject({ projectId: "p-2" });
    expect(reads).toEqual([]);
  });
});

describe("② 结构：ApplyBlueprintRepository 的方法名集合恒等于 {apply}", () => {
  it("端口源文件里没有第二个写方法名——没有回写蓝本的第二条通道", () => {
    const src = readFileSync(PORTS_SRC, "utf8");
    const m = /export interface ApplyBlueprintRepository \{([\s\S]*?)\n\}/m.exec(src);
    expect(m, "ApplyBlueprintRepository 接口本体找不到——白名单在护一个不存在的东西").not.toBeNull();
    const methods = [...(m![1] as string).matchAll(/^\s{2}(\w+)\s*\(/gm)].map((x) => x[1]);
    expect(new Set(methods)).toEqual(new Set(["apply"]));
  });

  it("方法名集合里没有任何回写动词（save/update/patch/write/upsert/sync 之类）", () => {
    const src = readFileSync(PORTS_SRC, "utf8");
    const m = /export interface ApplyBlueprintRepository \{([\s\S]*?)\n\}/m.exec(src);
    const methods = [...(m![1] as string).matchAll(/^\s{2}(\w+)\s*\(/gm)].map((x) => x[1]);
    for (const verb of ["save", "update", "patch", "write", "upsert", "sync", "delete"]) {
      expect(methods).not.toContain(verb);
    }
  });
});

describe("③ 契约级旁路清单：TEMPLATES_FORBIDDEN_ROUTES 钉住「不存在的路由」", () => {
  it("挂着至少一条与实例改动回写模板本体相关的禁止路由，且带理由", () => {
    expect(templates.TEMPLATES_FORBIDDEN_ROUTES.length).toBeGreaterThan(0);
    const hit = templates.TEMPLATES_FORBIDDEN_ROUTES.find((r) => r.route.includes("from-instance"));
    expect(hit, "没有找到「实例回写模板本体」这条禁止路由——契约清单被删空了").toBeDefined();
    expect(hit!.why.length).toBeGreaterThan(0);
  });
});
