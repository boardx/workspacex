/**
 * **控制器必须把契约 `in` 的每个键都透传给用例。**
 *
 * ## 为什么需要机械门控：漏传是**无声**的
 *
 * 控制器逐字段拼用例入参。少写一行会发生什么：
 *
 * · 请求体照样合法 —— `.strict()` 只挡**多余**的键，不挡少传的可选键；
 * · 服务端把那一列存成默认值（空串 / 空数组），不报错；
 * · 前端显示的是自己的本地 state，看起来"保存成功了"。
 *
 * 三处都对，只有刷新之后才发现改动没了。2026-08-25 `tags` 就是这么被丢掉一次的
 * （前端那侧），只有真栈 e2e 才发现；2026-08-26 加 `title`/`footer` 时，控制器这侧
 * **又漏了同样的两个字段**——同一个形状，换了一层。所以这条门控放在这里。
 *
 * ## 判据：源码文本，不是运行时
 *
 * 运行时要验证它，得对每个操作起真实 HTTP + 真库、逐字段回读，那是 8 条操作 × 每条
 * 一个隔离栈。而漏传是**静态**缺陷：`body.X` 那一行在不在源码里，看得见。
 *
 * ⚠ 因此它证明的是「这个键被引用了」，**不是**「被传到了正确的位置」。后者由各操作
 *   自己的 HTTP 测试覆盖（如 `update-template-metadata-http.test.ts` 回读断言）。
 *   两道各挡一种失效，都不能替代对方。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canvas } from "@repo/contracts";

const SOURCE = readFileSync(
  join(__dirname, "../../src/interface/controllers/canvas-template.controller.ts"),
  "utf8",
);

/**
 * 路径参数与鉴权主体不由 body 带，逐个说明豁免理由——不是"这些恰好没命中"。
 *
 * ⚠ 豁免必须逐条写死。写成"含 id 的都跳过"之类的模式匹配，会在下一个新字段恰好
 *   叫 `xxxId` 时**自动**放过它，而那正是这道门控要挡的事。
 */
const NOT_FROM_BODY: Readonly<Record<string, string>> = {
  // 路径参数：控制器从 `@Param` 取，且与 body 做一致性检查（见 assertKeyMatches）。
  key: "路径参数，另有一致性检查",
  version: "路径参数，另有一致性检查",
  // 鉴权主体：只能来自会话，读 body 就是允许调用方自称任意组织。
  orgId: "来自 principal，不读 body",
  userId: "来自 principal，不读 body",
};

/**
 * 本条门控覆盖的范围：**模板控制器**处理的那些写操作。
 *
 * 判据是契约自己的 `path` 前缀，不是一份手写清单——手写清单会在新增操作时忘记更新，
 * 而"忘记更新"恰好表现为"新操作不受门控"，与门控通过完全同形。
 *
 * ⚠ canvas 束的其余操作分散在别的控制器里（画布实例、mermaid、skill 绑定），
 *   本条**不覆盖**它们。不假装覆盖：把它们算进来会让这里从第一天起红 6 条
 *   （其中几条甚至根本没挂路由，那是另一类缺陷，见 `KNOWN_CONTRACT_GAPS`），
 *   而一条常红的门控很快会被整条跳过。
 */
const TEMPLATE_OPS = Object.entries(canvas.operations).filter(
  ([, op]) =>
    (op as { method: string }).method !== "GET"
    && (op as { path: string }).path.startsWith("/canvas/templates"),
);

describe("canvas 控制器：契约 in 的每个键都透传", () => {
  it("有写操作可查（反空转：前缀写错会筛成空集，每条都假绿）", () => {
    expect(TEMPLATE_OPS.length).toBeGreaterThanOrEqual(6);
  });

  it("控制器源码真的读到了（反空转：目录名写错会让每条都假绿）", () => {
    expect(SOURCE).toContain("body.displayName");
    expect(SOURCE.length).toBeGreaterThan(10_000);
  });

  it.each(TEMPLATE_OPS.map(([name, op]) => [name, op]))(
    "%s",
    (_name, op) => {
      const shape = (op as { in?: { shape?: Record<string, unknown> } }).in?.shape;
      if (shape === undefined) return; // 无 body 的操作
      const missing = Object.keys(shape)
        .filter((k) => NOT_FROM_BODY[k] === undefined)
        .filter((k) => !SOURCE.includes(`body.${k}`));
      expect(missing).toEqual([]);
    },
  );
});
