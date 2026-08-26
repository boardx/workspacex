/**
 * 「已发布模板也能编辑」的写路径分岔（人类 2026-08-26 截图实测原话）。
 *
 * ## 这条挡的两种**相反**的假实现
 *
 * 1. **能打字但保存不生效**——表单解禁了，`save()` 仍然只调 `updateTemplateDraft`，
 *    服务端对非草稿一律不改（零行影响），前端还报「已保存」。使用者改完刷新，
 *    改动没了，而整个过程没有任何一处报错。
 * 2. **真去改了已发布的快照**——图省事让服务端放行非草稿的原地更新。那会让
 *    **已经用这个模板开过的画布**在下次渲染时悄悄换掉版式（I-4：已建实例不被改动），
 *    是一次没人察觉的历史篡改。
 *
 * 两种都在界面上「看起来对」，所以判据必须落在**到底调了哪个 API、带了什么参数**上。
 *
 * ⚠ 这里断言的是 `template-editor-panel.tsx` 的源码事实，不是渲染出来的 DOM：
 *   分岔逻辑在 `save()` 里，而把它渲染出来要拉起整个三栏编辑器 + mock 掉两个真实
 *   写接口，那样的测试贵且脆，而且断言的仍然是同一件事。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(__dirname, "../../components/canvas/template-editor-panel.tsx"),
  "utf8",
);

/** 注释里也会出现这些词，判定必须只看代码行。 */
const CODE = SOURCE.split("\n")
  .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
  .join("\n");

describe("已发布模板的编辑走铸新版，不改快照", () => {
  it("两条写路径都真的被调用了——不是只解禁表单", () => {
    expect(CODE).toContain("updateCanvasTemplateDraft(");
    expect(CODE).toContain("mintCanvasTemplateVersion(");
  });

  it("分岔判据是 isDraft：草稿原地改，其余铸新版", () => {
    const save = CODE.slice(CODE.indexOf("async function save("));
    const draftAt = save.indexOf("updateCanvasTemplateDraft(");
    const mintAt = save.indexOf("mintCanvasTemplateVersion(");
    const branchAt = save.indexOf("if (isDraft)");
    expect(branchAt).toBeGreaterThanOrEqual(0);
    // 顺序：先判 isDraft → 草稿路径 → 非草稿路径。三者错位说明分岔挂错了地方。
    expect(branchAt).toBeLessThan(draftAt);
    expect(draftAt).toBeLessThan(mintAt);
  });

  it("铸新版带上了**改完的** sections，不是先开空版本再存第二次", () => {
    const mint = CODE.slice(CODE.indexOf("mintCanvasTemplateVersion("));
    const call = mint.slice(0, mint.indexOf("});") + 3);
    expect(call).toContain("sections: contractSections");
    expect(call).toContain("displayName: displayName.trim()");
  });

  it("表单对已发布开放，只有归档仍然只读", () => {
    expect(CODE).toContain('const editable = row.status !== "archived" && !readOnly;');
    // 反证：旧判据若残留，「已发布可编辑」就是假的。
    expect(CODE).not.toContain("const editable = isDraft && !readOnly");
  });

  it("`readOnly`（观察者视角）仍然压过一切", () => {
    const line = CODE.split("\n").find((l) => l.includes("const editable ="))!;
    expect(line).toContain("!readOnly");
  });
});
