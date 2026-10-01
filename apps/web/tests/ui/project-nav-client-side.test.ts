/**
 * UIUX R9（#4829）—— 项目 / Workflow 的站内导航必须走客户端导航（next/link），不能是裸 `<a>`。
 *
 * 为什么要守：裸 `<a href>` 每点一次都是整页重载——重新确认登录、重拉概览、重挂整个壳。
 * 真实浏览器实测：项目里切 tab 从 2.2~3.7 秒降到 ~130 毫秒（且不再整页重载）。
 * 这类回退肉眼看不出来（功能完全一样，只是变慢），所以用源码守卫：下面这些链接的 testid 所在的标签必须是 `<Link`。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(WEB, rel), "utf8");

/** 找到包含 `needle` 的那个 JSX 开标签（向前找最近的 `<Tag`），返回标签名。 */
function openingTagBefore(source: string, needle: string): string {
  const at = source.indexOf(needle);
  expect(at, `源码里找不到 ${needle}`).toBeGreaterThan(-1);
  const head = source.slice(0, at);
  const match = [...head.matchAll(/<(Link|a|Button|button)\b/g)].pop();
  expect(match, `${needle} 之前没有开标签`).toBeTruthy();
  return match![1]!;
}

/** testid 在外层 `<Button asChild>` 上时，真正渲染成链接的是紧随其后的子标签。 */
function openingTagAfter(source: string, needle: string): string {
  const at = source.indexOf(needle);
  expect(at, `源码里找不到 ${needle}`).toBeGreaterThan(-1);
  const match = /<(Link|a)\b/.exec(source.slice(at));
  expect(match, `${needle} 之后没有链接标签`).toBeTruthy();
  return match![1]!;
}

describe("R9 站内导航走客户端导航", () => {
  const cases: Array<[string, string, string]> = [
    ["components/project/project-workbench.tsx", "data-testid={`project-tab-${t.key}`}", "项目主标签"],
    ["components/project/project-workbench.tsx", "data-testid={`project-subnav-${it.key}`}", "项目子导航"],
    ["components/projects/projects-screen.tsx", "data-testid={`projects-card-${project.id}-enter`}", "列表卡「进入项目」"],
    ["components/workflow/workflow-nav.tsx", "data-testid={`workflow-nav-${item.key}`}", "Workflow 左栏"],
    ["components/workflow/workflow-nav.tsx", "data-testid={testId}", "返回项目"],
    ["components/project/tab-general-overview.tsx", 'data-testid="project-general-overview-workflow-runs"', "概览 → 运行看板"],
  ];
  it("全部项目（Button asChild 的子链接）不是裸 <a>", () => {
    expect(openingTagAfter(read("components/project/project-workbench.tsx"), 'data-testid="project-back-to-list"')).toBe("Link");
  });
  for (const [file, needle, label] of cases) {
    it(`${label}不是裸 <a>`, () => {
      const tag = openingTagBefore(read(file), needle);
      expect(tag).toBe("Link");
    });
  }
});
