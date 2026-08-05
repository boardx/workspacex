/**
 * #520 通用验收条款①的机械形态：**「新建 skill」这条用户路径不再从 `lib/mock/**` 取数。**
 *
 * ## 用 #458 的闭包走图器，不用 `covered-routes-no-mock.test.ts` 的单字符串检查
 *
 * 后者对**一个文件**做字符串断言。mock 依赖的真实失效方式是**间接的**：屏组件干干净净，
 * 它引的某个子组件里 `import { SKILLS } from "@/lib/mock/skill"`——单文件断言对此**照样变绿**。
 * 所以这里走 `./import-closure` 的传递闭包，和 #458 用的是**同一份**代码（见该文件头）。
 *
 * ## 锚点为什么是 `components/skill/skill-catalog-live.tsx`
 *
 * 这与 #458 锚在 `components/admin/agent-screen.tsx`（而不是 `app/admin/[module]/page.tsx`）
 * 是**同一个深度**：锚在「这条路径真正用来取数与写入的那个屏组件」上。
 *
 * ⚠ 这**不是**把断言重锚到一个更浅的入口去制造绿。判据是下面第三条：本文件强制
 * `/skill` 的默认屏（`screen=library`）**确实**渲染这个组件——锚点与用户实际走到的东西
 * 必须是同一个。若有人把 `skill-app.tsx` 改回渲染 mock 原型屏，第三条会红。
 *
 * ## 本 issue **没有**清掉的 mock 边，逐条钉在下面第四条
 *
 * `/skill` 扇出七屏，其中六屏（试跑 / 绑定 / 挂载 / 版本 / 晋升 / 反馈）的后端不在本波次
 * 范围内，它们仍然吃 mock。把这些边**逐条精确列出来**，而不是含糊地说「还有残留」：
 *
 *   · 新增一条 mock 边 ⇒ 第四条红（债在扩大，必须被看见）；
 *   · 清理一条 mock 边 ⇒ 第四条**也红**（清单该缩小，逼下一个人来改它）。
 *
 * 债因此是**可见地缩小**，而不是被藏进一句免责声明。#464 用的是同一手。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, walk } from "./import-closure";

/** 「新建 skill」这条路径真正用来取数与写入的屏组件。 */
const LIVE_ENTRY = "components/skill/skill-catalog-live.tsx";

/**
 * `/skill` 七屏编排壳的**全部**残留 mock 边，实测钉死。
 *
 * ⚠ 这是一份**债务台账**，不是白名单。它精确到边（`来源文件 -> mock 模块`），
 *   所以任何一侧变化都会红。每一条后面写清楚它等谁。
 */
const RESIDUAL_MOCK_EDGES: readonly string[] = [
  // 编排壳自己：左栏七屏导航常量 `SKILL_SCREENS` / `SKILL_SCREEN_LABEL` / `SKILL_VIEWS`
  // 是**值导入**，不是类型导入 —— 等七屏全部接真之后随 mock 文件一起消失。
  "components/skill/skill-app.tsx -> lib/mock/skill.ts",
  // 以下六屏的后端（试跑 / 绑定 / 会话内挂载 / 版本 / 晋升 / 反馈）本波次明确不在范围。
  "components/skill/skill-binding.tsx -> lib/mock/skill.ts",
  "components/skill/skill-feedback.tsx -> lib/mock/skill.ts",
  "components/skill/skill-library.tsx -> lib/mock/skill.ts",
  "components/skill/skill-promotion.tsx -> lib/mock/skill.ts",
  "components/skill/skill-shared.tsx -> lib/mock/skill.ts",
  "components/skill/skill-temp-mount.tsx -> lib/mock/skill.ts",
  "components/skill/skill-tryrun.tsx -> lib/mock/skill.ts",
  "components/skill/skill-versioning.tsx -> lib/mock/skill.ts",
];

describe("#520 /skill 的「新建 skill」路径不依赖 lib/mock", () => {
  it("新建/列表屏的整棵依赖树里没有任何一条指向 lib/mock 的边", () => {
    const { visited, mockEdges } = walk(LIVE_ENTRY);
    expect(mockEdges).toEqual([]);
    // 反空转：这棵树必须真的走到了取数与写入这两端，否则「没有 mock」是因为什么都没走。
    expect(visited).toContain("lib/live-skill.ts");
    expect(visited).toContain("lib/api-client.ts");
  });

  it("反证：同一个走图器对仍在吃 mock 的屏会报出 mock 边", () => {
    // 没有这条，上面那条断言可能只是因为走图器解析不出任何 import 而恒为空。
    const { mockEdges } = walk("components/skill/skill-versioning.tsx");
    expect(mockEdges.length).toBeGreaterThan(0);
    expect(mockEdges.join("\n")).toContain("lib/mock/");
  });

  it("锚点就是用户实际走到的那个屏：/skill 的默认屏渲染它，而不是 mock 原型", () => {
    const app = readFileSync(resolve(ROOT, "components/skill/skill-app.tsx"), "utf8");
    // `screen === "library"`（`resolveSkillScreen` 的缺省值，见 lib/mock/skill.ts:57-62）
    // 必须落在 live 屏上。改回 `<SkillLibrary` 这里会红。
    expect(app).toMatch(/screen === "library" && <SkillCatalogLive/);
    expect(app).toContain('from "./skill-catalog-live"');
    // 走图器锚的文件与它被渲染的名字是同一个东西。
    const live = readFileSync(resolve(ROOT, LIVE_ENTRY), "utf8");
    expect(live).toMatch(/export function SkillCatalogLive\b/);
  });

  it("残留 mock 边台账：新增一条会红，清理一条也会红", () => {
    const { mockEdges } = walk("components/skill/skill-app.tsx");
    // `toEqual` 而不是 `toContain`：只有精确相等才能让「清理了一条」也变红。
    expect(mockEdges).toEqual([...RESIDUAL_MOCK_EDGES].sort());
  });

  it("写路径打的是已签契约的真实端点，且不存在第二个 skill 写出口", () => {
    const client = readFileSync(resolve(ROOT, "lib/live-skill.ts"), "utf8");
    expect(client).toContain("skills.operations.createSkillDraft.path");
    expect(client).toContain("skills.operations.listSkills.path");
    expect(client).not.toMatch(/["']\/skills["']/); // 路径不得手抄一份

    // 全仓只有这一个文件调创建端点：多一个出口 = 多一处会漂移的请求体。
    const { visited } = walk(LIVE_ENTRY);
    const callers = visited.filter((f) =>
      readFileSync(resolve(ROOT, f), "utf8").includes("createSkillDraft.path"));
    expect(callers).toEqual(["lib/live-skill.ts"]);
  });
});
