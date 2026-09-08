/**
 * session-handoff 与 session-closer 的 description 必须可区分。
 *
 * 背景：两者正文互不重复、边界写清楚了，但 frontmatter 的激活关键词此前**逐词相同**
 * （收尾/交接/下一轮/干净状态/progress/handoff 两边都有）。模型按 description 选
 * skill，两份一模一样的触发词等于让它掷硬币——正文写得再清楚也没用，因为正文要
 * 被选中之后才读得到。
 *
 * 人类裁决（2026-09-09）：不合并两个 skill，只把关键词分开——
 *   session-handoff = 「写 handoff 文档 / 交接内容怎么写」
 *   session-closer  = 「收尾前逐项检查清单」
 *
 * 本测试把这条裁决钉住：交集关键词不许超过阈值，且各自的**判别词**必须在场。
 * 阈值不是「零交集」——两者都属于收尾场景，共享 1-2 个上位词是正常的；
 * 判别词在场才是真正的判据。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (name: string) => readFileSync(join(ROOT, ".agents", "skills", name, "SKILL.md"), "utf8");

/**
 * 取 frontmatter 里 `description: >` 的整块折叠标量。
 * ⚠ 不要用 `/^description:.*?(?=\n\S|$)/m` 这类写法：`/m` 会让 `$` 匹配**行尾**，
 * 惰性量词在第一行就停下，测试会拿着半句话去断言——本文件第一版就栽在这里，
 * 表现是「明明写了『模板』却断言失败」。这里改成按缩进逐行收集，行为不依赖标志位。
 */
function description(markdown: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (fm === null) throw new Error("没有 frontmatter");
  const lines = fm[1]!.split("\n");
  const start = lines.findIndex((l) => /^description:\s*>/.test(l));
  if (start === -1) throw new Error("没有 description");
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !/^\s/.test(line)) break;
    body.push(line);
  }
  if (body.join("").trim() === "") throw new Error("description 是空的");
  return body.join("\n");
}

/** 两边共有的上位词，本来就该共享，不参与交集计数。 */
const SHARED_TOPIC = ["收尾", "交接", "会话", "下一轮"];
const KEYWORDS = ["收尾", "交接", "下一轮", "干净状态", "progress", "handoff", "会话", "结束", "done", "关闭会话", "检查", "清单", "写"];

describe("session-handoff / session-closer 的激活关键词必须可区分", () => {
  const handoff = description(read("session-handoff"));
  const closer = description(read("session-closer"));

  it("两份 description 不相同（这正是它们此前的形状）", () => {
    expect(handoff).not.toBe(closer);
  });

  it("激活小句里除上位词外零共享判别词", () => {
    // 只比**激活小句**（`⚠` 之前）。`⚠` 之后是刻意写的边界提示，两边都点名对方
    // 的职责——那是让选错的读者立刻改道用的，不是触发词，拿它计交集会把正确的
    // 设计判成漂移。
    const activation = (text: string) => text.split("⚠")[0]!;
    const hit = (text: string) => new Set(KEYWORDS.filter((k) => activation(text).includes(k)));
    const both = [...hit(handoff)].filter((k) => hit(closer).has(k) && !SHARED_TOPIC.includes(k));
    expect(both, `仍然共享的判别词：${both.join("、")}`).toHaveLength(0);
  });

  it("session-handoff 的判别词在场：写作/模板/内容", () => {
    expect(handoff).toMatch(/写/);
    expect(handoff).toMatch(/模板|内容|方法论/);
  });

  it("session-closer 的判别词在场：逐项检查/清单", () => {
    expect(closer).toMatch(/检查|核对|清单|checklist/);
  });

  it("两边都显式指向对方的职责边界——被选错时读者能立刻改道", () => {
    expect(handoff).toContain("session-closer");
    expect(closer).toContain("session-handoff");
  });
});
