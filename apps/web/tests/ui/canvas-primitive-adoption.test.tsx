import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { TemplateDisplayPanel } from "@/components/canvas/template-display-panel";
import { TemplateDryRunDrawer } from "@/components/canvas/template-dry-run-drawer";
import type {
  SectionDraft,
  SectionLayoutDraft,
  TemplateHealth,
} from "@/components/canvas/template-editor-model";

/**
 * F22 —— canvas 模块原语补齐（design-delta `primitive-adoption-cleanup`，同 F21 那次签核）。
 *
 * ## 为什么这一条要有自己的测试，而不是靠 `lint:design`
 *
 * 两半交付里，**裸控件**那一半 `lint-design.sh` 的 U6 根本不看——U6 只扫 `app/`，
 * 而 canvas 的控件全在 `components/canvas/`。**裸 `-foreground`** 那一半 U12 是看的，
 * 但它是**逐行**判断：一行里只要同时出现一个合法的 `text-muted-foreground`，
 * 排除式 `grep -v` 就把整行滤掉，同一行上的裸 `text-foreground` 跟着一起消失。
 * canvas 里 6 处裸 `-foreground` 无一例外正是这个形状（`text-muted-foreground …
 * hover:text-foreground`），所以修复前 `lint:design` 是绿的——它证明不了这条 issue。
 *
 * 这里按 **token** 判、不按行判，补上那个缺口。修 U12 的逐行判据本身不在本 feature
 * 范围内（那是全仓门控的改动，会牵动 37 条存量豁免的匹配面），留给门控自己的 feature。
 *
 * ## 两层证据（沿用 F21 的结构）
 *
 * ① **静态**：`components/canvas/` 下不再有手写裸 `<input>`/`<textarea>`/`checkbox`，
 *    也不再有裸 `-foreground`——逐文件点名，不用行数近似。
 * ② **行为**：抽有代表性的面板，确认换成 `ui/input`·`ui/textarea`·`ui/checkbox`
 *    之后读写行为与 `onPatch*` 契约不变——这是签核里"交互行为不变，仅替换控件实现与
 *    颜色 token"的机械证明。
 */

const CANVAS_DIR = join(__dirname, "../../components/canvas");

// ui 原语自身的实现文件不在扫描范围内——它们就是"裸控件"合法存在的唯一位置。
const RAW_CONTROL_PATTERN = /<input\b|<textarea\b|type=["']checkbox["']/;

/**
 * 注释行不算违规——文档里写「这里挂一个 `<textarea>` 浮层」不该被判成违规本身。
 * 判据与 `lint-design.sh` 的 `strip_comments` 逐字同构（块注释续行 `*`、行注释 `//`、
 * 块注释起始 `/*`、JSX 注释 `{/*`），不另发明第二套。
 */
const COMMENT_LINE = /^\s*(\{\/\*|\/\*|\/\/|\*)/;

function codeLines(src: string): string[] {
  return src.split("\n").filter((line) => !COMMENT_LINE.test(line));
}

/**
 * 裸 `-foreground` 这一半，2026-09-23 起读**唯一**的那道门：
 * `.harness/scripts/lint-tailwind-color-tokens.mjs` 的 `scan()`（按 token、跨行、合法名解析自
 * `tailwind.config.ts`）。原来这里从 `lint-design.sh` 里解析 U12 的前缀清单——U12 已并入那道门，
 * 同一事实只留一处。这里只把全仓结果收窄到 `components/canvas/`，不另写判据。
 */
// @ts-expect-error —— .mjs 无类型声明，这里只用它导出的 `scan`。
import { scan as scanColorTokens } from "../../../../.harness/scripts/lint-tailwind-color-tokens.mjs";

function canvasColorTokenHits(): { file: string; line: number; cls: string }[] {
  return (scanColorTokens(join(__dirname, "../..")) as { file: string; line: number; cls: string }[])
    .filter((h) => h.file.startsWith("components/canvas/"));
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".tsx"));
}

describe("F22：canvas 目录不再有手写裸控件 / 裸 -foreground", () => {
  const files = tsxFiles(CANVAS_DIR);

  it("扫描到的 .tsx 文件不是空集——防止路径改了但断言仍然平凡为真", () => {
    expect(files.length).toBeGreaterThan(0);
  });


  it.each(files)("%s 不含裸 <input>/<textarea>/checkbox", (file) => {
    const hits = codeLines(readFileSync(join(CANVAS_DIR, file), "utf8"))
      .filter((line) => RAW_CONTROL_PATTERN.test(line));
    expect(hits, `${file} 仍有手写裸控件，应改用 components/ui/{input,textarea,checkbox}.tsx`).toEqual([]);
  });

  it("canvas 目录没有对不上 token 的颜色类名（含裸 -foreground）", () => {
    // ⭐ 反证锚点：在 components/canvas/ 任一文件里写一个 `hover:text-foreground` ⇒ 这条红。
    expect(canvasColorTokenHits(), "canvas 里有颜色类名对不上 token（Tailwind 不生成任何 CSS）").toEqual([]);
  });
});

// ── 行为不变 ────────────────────────────────────────────────────────────────

const LAYOUT: SectionLayoutDraft = {
  col: 0, row: 0, w: 4, h: 4, cols: 2, max: 6, tone: 0, overflow: "缩小字号",
};

function sectionOf(over: Partial<SectionDraft>): SectionDraft {
  return {
    sectionId: "s1", key: "gains", name: "收益", type: "便利贴列表", aiHint: null,
    order: 0, required: false, capacity: null, layout: { ...LAYOUT },
    content: "", color: null, fontSize: 24, fontWeight: "normal",
    hideFieldTitle: false, align: "left", valign: "top",
    ...over,
  };
}

const HEALTH: TemplateHealth = {
  fieldCount: 1, placedCount: 1, unplaced: [], overflowing: [], duplicateKeys: [],
  danglingPlaceholders: [], overlapping: [], publishClean: true,
};

function renderDisplayPanel(section: SectionDraft, editable = true) {
  const onPatchSection = vi.fn();
  const onPatch = vi.fn();
  render(
    <TemplateDisplayPanel
      section={section}
      sections={[section]}
      gridCols={12}
      health={HEALTH}
      editable={editable}
      onPatch={onPatch}
      onPatchSection={onPatchSection}
      onRemove={() => {}}
    />,
  );
  return { onPatch, onPatchSection };
}

describe("F22：换用共享原语后，行为不变", () => {
  it("显示方式 · 文本对象——文字内容仍是 textarea，改动仍走 onPatchSection", () => {
    const { onPatchSection } = renderDisplayPanel(sectionOf({ type: "文本对象", content: "旧文案" }));

    const content = screen.getByTestId("tpladmin-editor-text-content-input") as HTMLTextAreaElement;
    expect(content.tagName).toBe("TEXTAREA");
    expect(content.value).toBe("旧文案");
    fireEvent.change(content, { target: { value: "新文案" } });
    expect(onPatchSection).toHaveBeenCalledWith({ content: "新文案" });
  });

  it("显示方式 · 文本对象——字色仍是 input[type=color]，改动仍走 onPatchSection", () => {
    const { onPatchSection } = renderDisplayPanel(sectionOf({ type: "文本对象", color: "#14130f" }));

    const color = screen.getByTestId("tpladmin-editor-text-color") as HTMLInputElement;
    expect(color.type).toBe("color");
    fireEvent.change(color, { target: { value: "#336699" } });
    expect(onPatchSection).toHaveBeenCalledWith({ color: "#336699" });
  });

  it("显示方式 · 文本对象——只读态下控件仍然 disabled（原语接管 disabled 态 token）", () => {
    renderDisplayPanel(sectionOf({ type: "文本对象" }), false);

    expect((screen.getByTestId("tpladmin-editor-text-content-input") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByTestId("tpladmin-editor-text-color") as HTMLInputElement).disabled).toBe(true);
  });

  it("显示方式 · 数据字段——「隐藏字段名」仍是 checkbox，勾选仍走 onPatchSection", () => {
    const { onPatchSection } = renderDisplayPanel(sectionOf({ type: "短文本" }));

    const hide = screen.getByTestId("tpladmin-editor-hide-field-title") as HTMLInputElement;
    expect(hide.type).toBe("checkbox");
    expect(hide.checked).toBe(false);
    fireEvent.click(hide);
    expect(onPatchSection).toHaveBeenCalledWith({ hideFieldTitle: true });
  });

  it("试运行抽屉——数据输入仍是 textarea，改动仍走 onTextChange", () => {
    const onTextChange = vi.fn();
    render(
      <TemplateDryRunDrawer
        sections={[sectionOf({})]}
        text='{"gains":["A"]}'
        onTextChange={onTextChange}
        onRun={() => {}}
        onClose={() => {}}
      />,
    );

    const input = screen.getByTestId("tpladmin-editor-dryrun-input") as HTMLTextAreaElement;
    expect(input.tagName).toBe("TEXTAREA");
    expect(input.value).toBe('{"gains":["A"]}');
    fireEvent.change(input, { target: { value: '{"gains":["B"]}' } });
    expect(onTextChange).toHaveBeenCalledWith('{"gains":["B"]}');
  });
});
