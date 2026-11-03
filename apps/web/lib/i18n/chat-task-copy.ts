import { TASK_WORKBENCH_TEMPLATES, type TaskTemplate } from "../chat-task-templates";
import type { Locale } from "./locale";
import { translate } from "./messages";
const templateKeys = ["research", "reading", "planning", "analysis"] as const;
/** Only explicit template selection prefills these authored suggestions. Never transforms an existing draft. */
export function localizedTaskTemplates(locale: Locale): readonly TaskTemplate[] {
  if (locale === "zh-CN") return TASK_WORKBENCH_TEMPLATES;
  return TASK_WORKBENCH_TEMPLATES.map((template, index) => {
    const key = templateKeys[index]!;
    return { ...template, label: translate(locale, `chatEntry.${key}.label`), goal: translate(locale, `chatEntry.${key}.goal`), badge: translate(locale, `chatEntry.${key}.badge`) };
  });
}
