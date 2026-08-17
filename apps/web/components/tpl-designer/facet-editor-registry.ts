import type { ComponentType } from "react";
import { FacetTextEditor, PermissionMatrixEditor, type FacetSaveFn } from "./facet-content-editor";
import { TopicPanelEditor } from "./topic-panel-editor";
import { GroupingPanelEditor } from "./grouping-panel-editor";

export interface FacetEditorProps {
  readonly designFacetKey: string;
  readonly content: string;
  readonly itemRevision: string;
  readonly onSave: FacetSaveFn;
}

/**
 * F201（分组一第 3 项，「分组规则」结构化面板）新增此文件——`blueprint-designer-shell.tsx`
 * 里按 `selectedKey` 分派编辑器的三路 `? :` 链本身就是 `lint-design-facet-single-source.mjs`
 * 眼里的「第二张定义表」（I-5：一表一文件），哪怕它是 TSX 里的条件表达式而不是字面量对象。
 * 把分派收进这一份 `Record` 后，门控只认这一处，`blueprint-designer-shell.tsx` 只管渲染。
 */
const STRUCTURED_FACET_EDITORS: Record<string, ComponentType<FacetEditorProps>> = {
  "roles-and-perms": PermissionMatrixEditor,
  "topic-and-background": TopicPanelEditor,
  "grouping-rule": GroupingPanelEditor,
};

export function getFacetEditor(designFacetKey: string): ComponentType<FacetEditorProps> {
  return STRUCTURED_FACET_EDITORS[designFacetKey] ?? FacetTextEditor;
}
