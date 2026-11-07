import type { Locale } from "@repo/contracts/locale";
import type { LocalizedEntityDisplay } from "@repo/contracts/entity-localization";

interface Copy {
  title: string; description: string; sourceLanguage: string; unknown: string; sourceHint: string;
  saveSource: string; targetLanguage: string; original: string; translation: string;
  publish: string; save: string; saving: string; clear: string; loading: string; retry: string;
  saved: string; cleared: string; sourceSaved: string; denied: string; missing: string;
  conflict: string; loadFailed: string; saveFailed: string; blank: string; notProvided: string;
  sameSource: string; finishEdit: string;
  open: string;
  fields: Record<keyof LocalizedEntityDisplay["fields"], string>;
}
export const ENTITY_LOCALIZATION_COPY: Record<Locale, Copy> = {
  "zh-CN": {
    title: "展示内容翻译", description: "原文始终保留；未填写的译文继续使用原文。",
    sourceLanguage: "原文语言", unknown: "尚未指定", sourceHint: "更新原文语言后，需要重新检查现有译文。",
    saveSource: "保存原文语言", targetLanguage: "译文语言", original: "原文", translation: "译文",
    publish: "向成员展示此译文", save: "保存译文", saving: "正在保存…", clear: "移除译文",
    loading: "正在加载翻译…", retry: "重新加载", saved: "译文已保存", cleared: "译文已移除，继续显示原文。",
    sourceSaved: "原文语言已更新", denied: "你无权管理此内容的译文。", missing: "内容不可用或你无权访问。",
    conflict: "原文或译文已有更新。输入仍在编辑框中；重新加载会换成最新内容。", loadFailed: "翻译暂时无法加载。",
    saveFailed: "未能保存译文，请稍后重试。", blank: "留空时显示原文", notProvided: "尚未填写",
    sameSource: "请选择另一种语言来编辑译文。", finishEdit: "请先保存当前译文，再更新原文语言。",
    open: "管理译文",
    fields: { name: "名称", summary: "简介", duty: "职责", roleLabel: "角色头衔", avatarAlt: "头像替代文本" },
  },
  en: {
    title: "Display translations", description: "Original content is kept. Missing translations use the original.",
    sourceLanguage: "Original language", unknown: "Not specified", sourceHint: "Review existing translations after changing the original language.",
    saveSource: "Save original language", targetLanguage: "Translation language", original: "original", translation: "translation",
    publish: "Show this translation to members", save: "Save translation", saving: "Saving…", clear: "Remove translation",
    loading: "Loading translations…", retry: "Reload", saved: "Translation saved", cleared: "Translation removed. The original is shown.",
    sourceSaved: "Original language updated", denied: "You cannot manage translations for this content.", missing: "This content is unavailable or you cannot access it.",
    conflict: "The original or translation changed. Your input is still in the form; reload to replace it with the latest content.", loadFailed: "Translations could not be loaded.",
    saveFailed: "The translation could not be saved. Please try again.", blank: "Leave blank to use the original", notProvided: "Not provided",
    sameSource: "Choose another language to edit a translation.", finishEdit: "Save your translation before changing the original language.",
    open: "Manage translations",
    fields: { name: "Name", summary: "Summary", duty: "Duty", roleLabel: "Role title", avatarAlt: "Avatar alternative text" },
  },
};
