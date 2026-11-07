import { expect, it } from "vitest";
import { PROJECT_TABS, SUB_NAV, tabDefsForKind } from "@/lib/project-workbench";
import { localizedProjectTabs, localizedProjectSubNav } from "@/lib/i18n/project-workbench-copy";
it("keeps canonical kind-specific tab keys and default Chinese references", () => {
 for(const kind of ["workshop","general",null] as const){
  const source=tabDefsForKind(kind);expect(localizedProjectTabs(kind,"zh-CN")).toBe(source);const english=localizedProjectTabs(kind,"en");expect(english.map(x=>x.key)).toEqual(source.map(x=>x.key));for(const tab of english)expect(tab.label).not.toMatch(/\p{Script=Han}/u);
 }
});
it("keeps contextual subnavigation structure and leaves absent groups absent",()=>{
 for(const tab of PROJECT_TABS){
  expect(localizedProjectSubNav(tab,"zh-CN")).toBe(SUB_NAV[tab]);const english=localizedProjectSubNav(tab,"en");if(!SUB_NAV[tab]){expect(english).toBeUndefined();continue;}
  expect(english?.items.map(x=>x.key)).toEqual(SUB_NAV[tab]!.items.map(x=>x.key));expect(english?.section).not.toMatch(/\p{Script=Han}/u);for(const item of english!.items)expect(item.label).not.toMatch(/\p{Script=Han}/u);
 }
});
