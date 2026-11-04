import type { Locale } from "./locale";
import { translate } from "./messages";
import { projectWorkbenchZhCN } from "./namespaces/project-workbench";
import { SUB_NAV, tabDefsForKind, type ProjectContainerKind, type ProjectTab } from "@/lib/project-workbench";
function copy(locale: Locale, key: string) {
  if (!Object.hasOwn(projectWorkbenchZhCN, key)) throw new Error(`UNKNOWN_PROJECT_WORKBENCH_COPY:${key}`);
  return translate(locale, key as keyof typeof projectWorkbenchZhCN);
}
export function localizedProjectTabs(kind: ProjectContainerKind | null, locale: Locale) {
  const defs = tabDefsForKind(kind);
  return locale === "zh-CN" ? defs : defs.map(def => ({...def, label: copy(locale, `projectWorkbench.tab.${kind ?? "workshop"}.${def.key}`)}));
}
export function localizedProjectSubNav(tab: ProjectTab, locale: Locale) {
  const nav = SUB_NAV[tab];
  if (!nav || locale === "zh-CN") return nav;
  return {...nav, section: copy(locale, `projectWorkbench.sub.${tab}.section`), items: nav.items.map(item => ({...item, label: copy(locale, `projectWorkbench.sub.${tab}.${item.key}`)}))};
}
