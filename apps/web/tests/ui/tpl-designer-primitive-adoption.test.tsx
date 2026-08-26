import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentPanelEditor } from "@/components/tpl-designer/agent-panel-editor";
import { PrintPanelEditor } from "@/components/tpl-designer/print-panel-editor";
import { TopicPanelEditor } from "@/components/tpl-designer/topic-panel-editor";
import { PermissionMatrixEditor, type FacetSaveFn } from "@/components/tpl-designer/facet-content-editor";

/**
 * F21 —— tpl-designer 原语补齐（design-delta `primitive-adoption-cleanup`，2026-08-26 已签核）。
 *
 * ## 两层证据
 *
 * ① **静态**：`components/tpl-designer/` 下不再有手写裸 `<input>`/`<textarea>`/
 * `type="checkbox"`——审计发现的重灾区（20 个文件同构复制、约 60 处）必须真的清零，
 * 不是抽样清了几个就收工。用源码正则扫描全目录，逐文件点名，不用行数近似。
 *
 * ② **行为**：抽 3 个有代表性的面板编辑器（agent：文本 + checkbox + number；
 * print：文本 + checkbox + textarea；topic：文本 + textarea）与权限矩阵表格
 * （checkbox 网格），确认换成 `ui/input`·`ui/textarea`·`ui/checkbox` 之后
 * 读写行为、onSave 契约不变——这是签核里"字段读写逻辑、保存时机…一律不变，
 * 只换控件实现"的机械证明，不是重新设计一遍这些面板。
 */

const TPL_DESIGNER_DIR = join(__dirname, "../../components/tpl-designer");

// ui 原语自身的实现文件不在扫描范围内——它们就是"裸控件"合法存在的唯一位置。
const RAW_CONTROL_PATTERN = /<input\b|<textarea\b|type=["']checkbox["']/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".tsx"));
}

describe("F21：tpl-designer 目录不再有手写裸控件", () => {
  const files = tsxFiles(TPL_DESIGNER_DIR);

  it("扫描到的 .tsx 文件不是空集——防止路径改了但断言仍然平凡为真", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s 不含裸 <input>/<textarea>/checkbox", (file) => {
    const src = readFileSync(join(TPL_DESIGNER_DIR, file), "utf8");
    expect(RAW_CONTROL_PATTERN.test(src), `${file} 仍有手写裸控件，应改用 components/ui/{input,textarea,checkbox}.tsx`).toBe(
      false,
    );
  });
});

const noopSave: FacetSaveFn = async (designFacetKey, value) => ({
  itemRevision: `rev-${designFacetKey}-${value.length}`,
  completeness: { done: 1, denominator: 15 },
});

describe("F21：换用共享原语后，行为不变", () => {
  it("AgentPanelEditor —— 文本输入、canSpeak checkbox、数值输入均可用", () => {
    render(
      <AgentPanelEditor designFacetKey="agent" content="" itemRevision="" onSave={noopSave} />,
    );
    fireEvent.click(screen.getByTestId("bp-agent-add"));

    const nameInput = screen.getByTestId("bp-agent-name-0") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Facilitator" } });
    expect(nameInput.value).toBe("Facilitator");

    const canSpeak = screen.getByTestId("bp-agent-canspeak-0") as HTMLInputElement;
    expect(canSpeak.type).toBe("checkbox");
    expect(canSpeak.checked).toBe(false);
    fireEvent.click(canSpeak);
    expect(canSpeak.checked).toBe(true);

    const threshold = screen.getByTestId("bp-agent-threshold") as HTMLInputElement;
    expect(threshold.type).toBe("number");
    fireEvent.change(threshold, { target: { value: "7" } });
    expect(threshold.value).toBe("7");
  });

  it("PrintPanelEditor —— 名称输入、AI 生成 checkbox、说明 textarea 均可用", () => {
    render(
      <PrintPanelEditor designFacetKey="print" content="" itemRevision="" onSave={noopSave} />,
    );
    fireEvent.click(screen.getByTestId("bp-print-add"));

    const nameInput = screen.getByTestId("bp-print-name-0") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "HMW 画布" } });
    expect(nameInput.value).toBe("HMW 画布");

    const aiCheckbox = screen.getByTestId("bp-print-ai-0") as HTMLInputElement;
    expect(aiCheckbox.type).toBe("checkbox");
    fireEvent.click(aiCheckbox);
    expect(aiCheckbox.checked).toBe(true);

    const detail = screen.getByTestId("bp-print-detail-0") as HTMLTextAreaElement;
    expect(detail.tagName).toBe("TEXTAREA");
    fireEvent.change(detail, { target: { value: "与画布模板同构" } });
    expect(detail.value).toBe("与画布模板同构");
  });

  it("TopicPanelEditor —— 主题陈述 textarea 与背景要素文本输入均可用", () => {
    render(
      <TopicPanelEditor designFacetKey="topic" content="" itemRevision="" onSave={noopSave} />,
    );
    const statement = screen.getByTestId("bp-topic-statement-input") as HTMLTextAreaElement;
    expect(statement.tagName).toBe("TEXTAREA");
    fireEvent.change(statement, { target: { value: "这次要解决 X" } });
    expect(statement.value).toBe("这次要解决 X");
  });

  it("PermissionMatrixEditor —— 权限矩阵单元格 checkbox 可切换", () => {
    render(
      <PermissionMatrixEditor designFacetKey="roles" content="" itemRevision="" onSave={noopSave} />,
    );
    const cells = screen.getAllByTestId(/^bp-permission-cell-/);
    expect(cells.length).toBeGreaterThan(0);
    const firstUnlocked = cells.find((c) => !(c as HTMLInputElement).disabled);
    expect(firstUnlocked, "至少要有一个未锁定的权限格用于验证可切换").toBeDefined();
    const cell = firstUnlocked as HTMLInputElement;
    expect(cell.type).toBe("checkbox");
    const before = cell.checked;
    fireEvent.click(cell);
    expect(cell.checked).toBe(!before);
  });
});
