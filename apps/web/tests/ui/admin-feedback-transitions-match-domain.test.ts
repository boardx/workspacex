/**
 * FB-3 —— 后台屏那张分诊转移表与 **domain 状态机**逐条对账。
 *
 * ## 为什么需要这条测试
 *
 * `components/admin/feedback-screen.tsx` 的 `NEXT_STATUSES` 是
 * `apps/api/src/domain/feedback/product-feedback.ts` 里 `ALLOWED_TRANSITIONS` 的
 * **第二份副本**。本仓已五次因「同一事实声明在两处」而漂移，所以第二份副本只有在
 * 有机械对账时才被允许存在——这就是那道对账。
 *
 * 漂移的表现极难发现：domain 加了一条边而界面不出按钮，用户看到的是
 * 「这个操作做不了」；界面多出一条 domain 不认的边，用户看到的是点了报 422。
 * 两者都不会让任何测试变红。
 *
 * ## 为什么是**解析文本**而不是 import
 *
 * `apps/web` 不依赖 `apps/api`（洋葱边界，`lint-arch-deps` 会拦），
 * 一次跨 app 的 import 会让前端构建拖进后端的整棵依赖树。
 * 本仓的其他门控（`lint-permission-paths` / `registration-repo-is-write-only`）
 * 用的是同一手法：解析源码文本。
 *
 * ⚠ 解析不到（文件改名/改写法）时**报错**，不是跳过。一条「找不到就算过」的对账
 *   在它最该报警的那一天恰好是绿的。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NEXT_STATUSES } from "@/components/admin/feedback-screen";

const DOMAIN_FILE = join(
  __dirname, "..", "..", "..", "api", "src", "domain", "feedback", "product-feedback.ts",
);

/** 从 domain 源码里抽出 `ALLOWED_TRANSITIONS` 那张表。 */
function parseDomainTransitions(): Record<string, string[]> {
  const source = readFileSync(DOMAIN_FILE, "utf8");
  const block = /const ALLOWED_TRANSITIONS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (block === null) {
    throw new Error(`解析不到 ALLOWED_TRANSITIONS —— ${DOMAIN_FILE} 改了写法或改了名，这条对账必须跟着改`);
  }
  const out: Record<string, string[]> = {};
  for (const line of block[1]!.split("\n")) {
    const m = /^\s*([^\s:]+)\s*:\s*\[([^\]]*)\]/.exec(line);
    if (m === null) continue;
    const targets = m[2]!
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s !== "");
    out[m[1]!] = targets;
  }
  return out;
}

describe("FB-3 分诊按钮 ↔ domain 状态机", () => {
  it("解析出的 domain 表非空 —— 空表会让下面每条断言平凡通过", () => {
    const domain = parseDomainTransitions();
    expect(Object.keys(domain).length).toBeGreaterThan(0);
    expect(Object.values(domain).flat().length).toBeGreaterThan(0);
  });

  it("状态集合逐个相等", () => {
    const domain = parseDomainTransitions();
    expect(Object.keys(domain).sort()).toEqual(Object.keys(NEXT_STATUSES).sort());
  });

  it("每个状态的出边逐条相等 —— 界面不多一条、也不少一条", () => {
    const domain = parseDomainTransitions();
    for (const [from, targets] of Object.entries(domain)) {
      expect([...(NEXT_STATUSES[from as keyof typeof NEXT_STATUSES] ?? [])].sort()).toEqual(
        [...targets].sort(),
      );
    }
  });
});
