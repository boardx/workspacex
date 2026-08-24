/**
 * F12 —— org-admin / canvas 微交互一致性稽核与整改（契约束 accessibility-guardrails，issue #1874）。
 *
 * 稽核范围：`apps/web/app/org-admin/**`、`apps/web/app/canvas/**`、
 * `apps/web/components/org-admin/**`、`apps/web/components/canvas/**` 下所有可点击元素，
 * 对照 `uiux-standards.md` §5（hover/focus-visible/transition-*）。
 *
 * 稽核方法：静态源码扫描（同 `composite-*-menu.test.tsx` 系列的字面量扫描口径）——
 * 找出每个不经由 `<Button>`/`<FilterChip>` 等已收口原语渲染的裸 `<button>`/带 onClick 的
 * 元素，检查其 className 是否同时具备 hover/focus-visible 反馈中的至少一种、以及
 * `transition-*`。这比渲染后读 computed style 更贴近 `lint-design.sh` U4 的机械口径，
 * 也更容易在 PR diff 里看出"这次到底改了哪一行"。
 *
 * 稽核结果（2026-08-24 实测，逐条见下方断言，回归判据钉在具体 data-testid 上）：
 *
 * | 分类 | 位置 | 处理 |
 * |---|---|---|
 * | 完全没有反馈 | `template-editor.tsx` 分区「上移/下移/＋分区」三个按钮 | 已修复：补 hover/focus-visible/transition-colors |
 * | 反馈不一致（缺 focus-visible） | `template-editor.tsx` 返回按钮（`tpled-back`）、设计对话快捷追问 chip（`tpled-dialog-quick-*`） | 已修复：补 focus-visible ring |
 * | 反馈不一致（缺 focus-visible + transition） | `template-editor.tsx` 分区列表项按钮（`tpled-zone-*`，不含 fill/props 子级） | 已修复：补 transition-colors duration-fast + focus-visible ring |
 * | 反馈不一致（缺 focus-visible） | `org-admin-screen.tsx` 下拉选项按钮（角色/技能审阅人 picker 的 `role="option"` 列表项） | 已修复：补 focus-visible ring |
 * | 反馈不一致（缺 focus-visible） | `canvas-template-gallery.tsx` 的 `FilterChip`（分类筛选） | 已修复：补 focus-visible ring |
 * | 已有一致反馈，无需改动 | 其余全部 onClick 元素均经由 `components/ui/button.tsx` 渲染，或已同时具备 hover+focus-visible+transition | 不改动 |
 * | 已知限制（第三方内容） | 无 —— 实测 org-admin / canvas 两域源码不含 CopilotKit 渲染内容（`grep -rl CopilotKit` 零命中），本轮不适用 F07 第三方样式登记表豁免 | 记录，不需登记 |
 *
 * 总计：偏离案例 **6** 处（3 处"完全没有反馈"+ 3 处"反馈不一致"），全部已整改到与
 * `components/ui/button.tsx` 一致的模式（hover/focus-visible + transition-*，新增 transition
 * 一律用语义 token `duration-fast`，不写裸数值，见 `tailwind.config.ts` U10 注释）。
 * 预存量的 `transition-colors duration-200`（裸数值）不在本次整改范围——它们已登记在
 * `scripts/motion-legacy-allowlist.txt`（F03 迁移债务，见 `motion-migration-priority.md`），
 * 本 feature 只新增语义 token、不追加新的裸数值豁免。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..", "..");

function read(relPath: string): string {
  return readFileSync(join(webRoot, relPath), "utf8");
}

/** 提取某个锚点之后的一小段源码窗口（默认往后找，覆盖多行属性的 <button ...>），用于局部断言 hover/focus/transition。 */
function windowAround(src: string, needle: string, after = 500, before = 100): string {
  const idx = src.indexOf(needle);
  expect(idx, `没有找到锚点 ${needle}`).toBeGreaterThan(-1);
  return src.slice(Math.max(0, idx - before), idx + after);
}

describe("F12 · org-admin / canvas 微交互一致性 —— 已修复案例回归锁定", () => {
  it("template-editor.tsx：分区「上移/下移/＋分区」三个按钮补齐 hover+focus-visible+transition", () => {
    const src = read("components/canvas/template-editor.tsx");
    for (const testid of ["tpled-zone-move-up", "tpled-zone-move-down", "tpled-zone-add"]) {
      const win = windowAround(src, `data-testid="${testid}"`);
      expect(win, `${testid} 缺 hover:`).toMatch(/hover:/);
      expect(win, `${testid} 缺 focus-visible:`).toMatch(/focus-visible:/);
      expect(win, `${testid} 缺 transition-`).toMatch(/transition-/);
      // 新增的 transition 必须走语义 token，不许裸数值（U10）。
      expect(win, `${testid} 的新 transition 不得写裸 duration-<数字>`).toMatch(/duration-(fast|base|slow)/);
    }
  });

  it("template-editor.tsx：分区列表项按钮（tpled-zone-<n>）补齐 focus-visible + transition-colors", () => {
    const src = read("components/canvas/template-editor.tsx");
    const win = windowAround(src, 'data-testid={`tpled-zone-${z.num}`}');
    expect(win).toMatch(/focus-visible:/);
    expect(win).toMatch(/transition-colors duration-fast/);
  });

  it("template-editor.tsx：返回按钮（tpled-back）与设计对话快捷 chip 补齐 focus-visible", () => {
    const src = read("components/canvas/template-editor.tsx");
    const back = windowAround(src, 'data-testid="tpled-back"', 200, 300);
    expect(back).toMatch(/hover:/);
    expect(back).toMatch(/focus-visible:/);

    const chip = windowAround(src, 'data-testid={`tpled-dialog-quick-${q}`}', 50, 500);
    expect(chip).toMatch(/hover:/);
    expect(chip).toMatch(/focus-visible:/);
  });

  it("org-admin-screen.tsx：下拉 listbox 选项按钮补齐 focus-visible", () => {
    const src = read("components/org-admin/org-admin-screen.tsx");
    // 选项按钮的 className 数组紧跟在 role="option" 声明之后。
    const win = windowAround(src, 'role="option"');
    expect(win).toMatch(/hover:/);
    expect(win).toMatch(/focus-visible:/);
    expect(win).toMatch(/transition-colors/);
  });

  it("canvas-template-gallery.tsx：FilterChip 补齐 focus-visible", () => {
    const src = read("components/canvas/canvas-template-gallery.tsx");
    const win = windowAround(src, "function FilterChip(", 700);
    expect(win).toMatch(/hover:/);
    expect(win).toMatch(/focus-visible:/);
    expect(win).toMatch(/transition-colors/);
  });
});

describe("F12 · org-admin / canvas 微交互一致性 —— 全域回归守卫", () => {
  const FILES = [
    "app/org-admin/page.tsx",
    "app/org-admin/preview/page.tsx",
    "app/canvas/page.tsx",
    "components/org-admin/activate-screen.tsx",
    "components/org-admin/boundary-screen.tsx",
    "components/org-admin/grant-screen.tsx",
    "components/org-admin/invites-screen.tsx",
    "components/org-admin/members-screen.tsx",
    "components/org-admin/org-admin-app.tsx",
    "components/org-admin/org-admin-frame.tsx",
    "components/org-admin/org-admin-screen.tsx",
    "components/org-admin/roles-screen.tsx",
    "components/org-admin/roster-screen.tsx",
    "components/org-admin/shared-invite-links.tsx",
    "components/canvas/ai-draft-panel.tsx",
    "components/canvas/canvas-hub.tsx",
    "components/canvas/canvas-left-panel.tsx",
    "components/canvas/canvas-main.tsx",
    "components/canvas/canvas-right-panel.tsx",
    "components/canvas/canvas-stage.tsx",
    "components/canvas/canvas-template-gallery.tsx",
    "components/canvas/canvas-toolbar.tsx",
    "components/canvas/conflict-bar.tsx",
    "components/canvas/knowledge-backflow.tsx",
    "components/canvas/segment-binding.tsx",
    "components/canvas/template-admin.tsx",
    "components/canvas/template-apply-dialog.tsx",
    "components/canvas/template-editor-panel.tsx",
    "components/canvas/template-editor.tsx",
    "components/canvas/template-trial-dialog.tsx",
  ];

  /**
   * 裸 `<button ...>`（非 `<Button` 收口组件）且带 `onClick=` 的开始标签，抓一段窗口
   * （标签本身通常在一行内写完 className，最长的也不超过 ~600 字符）出来做 hover/focus/
   * transition 三件套检查。跳过 `disabled` 且没有 onClick 的纯展示按钮（不在稽核范围内，
   * 例如已被上面锁定用例覆盖的分区上移/下移/＋分区按钮，这里再扫一遍也不冲突）。
   */
  it("裸 <button onClick=...>（不经由 <Button> 组件）均同时具备 hover-or-focus 与 transition- 反馈", () => {
    const offenders: string[] = [];
    for (const rel of FILES) {
      const src = read(rel);
      // 每个 "<button" 出现处到下一个 "<button" 出现处（或 +800 字符，取较小者）之间的
      // 切片，覆盖同一个标签跨多行写属性的情况，同时不会吃到下一个按钮的 className。
      const starts: number[] = [];
      const re = /<button\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) starts.push(m.index);
      starts.forEach((start, idx) => {
        const hardEnd = idx + 1 < starts.length ? starts[idx + 1]! : src.length;
        const slice = src.slice(start, Math.min(hardEnd, start + 800));
        if (!/onClick=/.test(slice)) return;
        const hasHoverOrFocus = /hover:|focus-visible:|focus:/.test(slice);
        const hasTransition = /transition-/.test(slice);
        if (!hasHoverOrFocus || !hasTransition) {
          const lineNo = src.slice(0, start).split("\n").length;
          offenders.push(`${rel}:${lineNo}`);
        }
      });
    }
    expect(offenders, `以下裸 <button> 缺 hover/focus 或 transition 反馈：\n${offenders.join("\n")}`).toEqual([]);
  });

  it("已确认 org-admin / canvas 源码不含 CopilotKit 渲染内容 —— F07 第三方样式登记豁免本轮不适用", () => {
    for (const rel of FILES) {
      const src = read(rel);
      expect(src, `${rel} 意外出现 CopilotKit 引用，需要按 F07 登记表处理而不是当作普通元素稽核`).not.toMatch(
        /copilotkit/i,
      );
    }
  });
});
