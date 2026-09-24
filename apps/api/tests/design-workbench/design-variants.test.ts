/**
 * 对标 R9（#3954）—— 变体：模型出几个方案，服务端只放行合法且互不相同的；不够数就如实失败，不凑。
 */
import { describe, expect, it, vi } from "vitest";
import { designWorkbench as C } from "@repo/contracts";
import {
  DESIGN_VARIANTS_SYSTEM_PROMPT,
  DesignVariantsUnavailableError,
  ModelDesignVariantProposer,
  parseVariants,
  proposeVariants,
} from "../../src/application/design-workbench/design-variants";
import { DesignProjectNotOwnerError, type DesignProjectDeps } from "../../src/application/design-workbench/project-shared";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDesignProjectRepo, designProjectRow } from "../support/fake-design-project-repo";

const page = (title: string) => ({
  type: "stack", children: [{ type: "text", props: { content: title, variant: "title" } }, { type: "button", props: { label: "立即购买", variant: "primary" } }],
});

function setup(text: string | (() => Promise<never>)) {
  const repo = new FakeDesignProjectRepo();
  repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", frames: ["商品详情", "空页"], prototype: [{ id: "n1", type: "stack", children: [] }, null] }));
  const complete = typeof text === "string" ? async () => ({ text, tokens: 0 }) : text;
  const model = { complete: vi.fn(complete) };
  const ai = new ModelDesignVariantProposer({ model: model as never, chatModel: { provider: "p", modelId: "m" }, log: () => {} });
  const deps: DesignProjectDeps & { ai: typeof ai } = { projects: repo, orgId: toOrgId("org-1"), ai };
  return { deps, model };
}

describe("对标 R9 变体", () => {
  it("三个合法方案原样返回；提示词带着这一页的名字与现有树", async () => {
    const { deps, model } = setup(JSON.stringify({ variants: ["A", "B", "C"].map((t) => ({ summary: `方案 ${t}`, root: page(t) })) }));
    const out = await proposeVariants(deps, { projectId: "dp-1", ownerId: "u-1", screen: 0 });
    expect(out.variants.map((v) => v.summary)).toEqual(["方案 A", "方案 B", "方案 C"]);
    expect(C.operations.proposeVariants.out.parse(out)).toBeTruthy();
    const call = (model.complete.mock.calls as unknown as [{ system: string; user: string }][])[0]![0];
    expect(call.system).toBe(DESIGN_VARIANTS_SYSTEM_PROMPT);
    expect(call.user).toContain("「商品详情」");
    expect(call.user).toContain("3 个");
  });

  it("不合法的树与重复方案被丢掉；只剩一个 ⇒ 如实失败，不拿当前页凑数", async () => {
    const { deps } = setup(JSON.stringify({ variants: [
      { summary: "A", root: page("A") },
      { summary: "A 抄一遍", root: { ...page("A"), id: "x" } },
      { summary: "坏", root: { type: "no-such-type" } },
    ] }));
    await expect(proposeVariants(deps, { projectId: "dp-1", ownerId: "u-1", screen: 0 })).rejects.toBeInstanceOf(DesignVariantsUnavailableError);
  });

  it("parseVariants 按 count 截断；variants 不是数组 ⇒ 空", () => {
    const raw = { variants: ["A", "B", "C", "D"].map((t) => ({ summary: t, root: page(t) })) };
    expect(parseVariants(raw, 2).map((v) => v.summary)).toEqual(["A", "B"]);
    expect(parseVariants({ variants: "x" }, 3)).toEqual([]);
  });

  it("模型调用失败 / 输出不是 JSON ⇒ DesignVariantsUnavailableError", async () => {
    const failing = setup(async () => { throw new Error("boom"); });
    await expect(proposeVariants(failing.deps, { projectId: "dp-1", ownerId: "u-1", screen: 0 })).rejects.toBeInstanceOf(DesignVariantsUnavailableError);
    const prose = setup("我觉得可以这样改……");
    await expect(proposeVariants(prose.deps, { projectId: "dp-1", ownerId: "u-1", screen: 0 })).rejects.toBeInstanceOf(DesignVariantsUnavailableError);
  });

  it("非 owner ⇒ 403 且不调模型；这一页没画出来 ⇒ NO_PROTOTYPE", async () => {
    const { deps, model } = setup("{}");
    await expect(proposeVariants(deps, { projectId: "dp-1", ownerId: "u-2", screen: 0 })).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
    await expect(proposeVariants(deps, { projectId: "dp-1", ownerId: "u-1", screen: 1 })).rejects.toMatchObject({ reason: "NO_PROTOTYPE" });
    expect(model.complete).not.toHaveBeenCalled();
  });
});
