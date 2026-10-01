/**
 * 卡片 / 标签统一的源码门（2026-09-30 人类要求，issue #4800）：
 * 列表页的卡片必须走 `ResourceCard`，标签筛选走 `TagFilterBar`，标签输入走 `TagInput`/`TagField`/`InlineTagEditor`。
 * 这些是「禁止回退」的机械核对，不是行为测试——行为在各组件自己的测试里。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const CARD_FILES = [
  "components/projects/projects-screen.tsx",
  "components/design-loop/workbench-screen.tsx",
  "components/admin/entity-catalog.tsx",
  "components/skill/skill-catalog-live.tsx",
  "components/project/project-content-card.tsx",
  "components/whiteboard/whiteboard-library.tsx",
  "components/tpl/blueprint-list-screen.tsx",
  "components/agent/agent-directory.tsx",
  "components/survey/resource-library/survey-resource-library.tsx",
  "components/survey/live/survey-library.tsx",
];

const FILTER_FILES = [
  "components/projects/projects-screen.tsx",
  "components/design-loop/workbench-screen.tsx",
  "components/design-loop/inbox-screen.tsx",
  "components/admin/entity-catalog.tsx",
  "components/canvas/template-admin.tsx",
  "components/whiteboard/whiteboard-library.tsx",
  "components/tpl/blueprint-list-screen.tsx",
  "components/survey/resource-library/survey-resource-library.tsx",
  "components/studio/studio-history.tsx",
];

describe("卡片与标签单一事实源", () => {
  it.each(CARD_FILES)("%s 用 ResourceCard", (f) => {
    expect(read(f)).toMatch(/ResourceCard/);
  });

  it.each(FILTER_FILES)("%s 用 TagFilterBar，不自画标签筛选按钮", (f) => {
    const src = read(f);
    expect(src).toMatch(/TagFilterBar/);
    expect(src).not.toMatch(/-tag-filter-(clear|more)/);
  });

  it("标签输入不再各自手写：创建对话框统一走 TagField", () => {
    for (const f of [
      "components/rec/create-transcription-dialog.tsx",
      "components/research-studio/create-guided-research-dialog.tsx",
      "components/itv/digital-interview-create-modal.tsx",
      "components/survey/live/create-survey-dialog.tsx",
    ]) {
      expect(read(f), f).toMatch(/TagField/);
    }
  });
  it("通用标签工具不声明业务限制，Studio 表单从契约推导", () => {
    expect(read("lib/tag-utils.ts")).not.toMatch(/STUDIO_TAG_LIMITS|maxTags:\s*\d|maxTagLength:\s*\d/);
    for (const file of ["components/rec/create-transcription-dialog.tsx", "components/research-studio/create-guided-research-dialog.tsx", "components/itv/digital-interview-create-modal.tsx", "components/survey/live/create-survey-dialog.tsx", "components/survey/resource-library/survey-create-dialog.tsx"]) {
      expect(read(file), file).toMatch(/tagInputLimits\(/);
    }
  });

});
