import { afterEach, expect, it } from "vitest";
import { PROTOTYPE_TABLE_INTERACTIONS } from "@/lib/prototype-table-interactions";
afterEach(() => { document.body.innerHTML = ""; });
it("searches, filters, opens local details and shows a no-match state", () => {
  document.body.innerHTML = `<input type="search" placeholder="搜索资料"><select><option>全部类型</option><option>PDF</option><option>Word</option></select><table><thead><tr><th>资料名称</th><th>类型</th></tr></thead><tbody><tr><td>访谈记录</td><td>PDF</td><td><button>打开</button></td></tr><tr><td>研究计划</td><td>Word</td><td><button>打开</button></td></tr></tbody></table>`;
  new Function(PROTOTYPE_TABLE_INTERACTIONS)();
  const search = document.querySelector("input")!;
  const select = document.querySelector("select")!;
  const rows = [...document.querySelectorAll("tbody tr")];
  search.value = "不存在"; search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(rows.every((r) => (r as HTMLElement).style.display === "none")).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("没有匹配");
  search.value = ""; search.dispatchEvent(new Event("input", { bubbles: true }));
  select.value = "PDF"; select.dispatchEvent(new Event("change", { bubbles: true }));
  expect((rows[0] as HTMLElement).style.display).toBe("");
  expect((rows[1] as HTMLElement).style.display).toBe("none");
  document.querySelector("button")!.click();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("访谈记录");
  document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("filters only the type column, ignores unrelated selects and traps modal focus", () => {
  document.body.innerHTML = `<main><input type="search"><select aria-label="类型"><option>全部类型</option><option>PDF</option><option>Word</option></select><select aria-label="排序"><option>按时间</option><option>按名称</option></select><table><thead><tr><th>资料名称</th><th>类型</th></tr></thead><tbody><tr><td>PDF 入门</td><td>Word</td><td><button>打开</button></td></tr><tr><td>访谈</td><td>PDF</td><td><button>打开</button></td></tr></tbody></table><button id="outside">外部按钮</button></main>`;
  new Function(PROTOTYPE_TABLE_INTERACTIONS)();
  const type = document.querySelector('select[aria-label="类型"]') as HTMLSelectElement;
  type.value = "PDF"; type.dispatchEvent(new Event("change", { bubbles:true }));
  const rows = document.querySelectorAll<HTMLElement>("tbody tr");
  expect(rows[0]!.style.display).toBe("none");
  expect(rows[1]!.style.display).toBe("");
  const sort = document.querySelector('select[aria-label="排序"]') as HTMLSelectElement;
  sort.value = "按名称"; sort.dispatchEvent(new Event("change", { bubbles:true }));
  expect(rows[1]!.style.display).toBe("");
  rows[1]!.querySelector<HTMLButtonElement>('button')!.click();
  const dialog = document.querySelector('[role="dialog"]')!;
  const close = dialog.querySelector<HTMLButtonElement>('button')!;
  const tab = new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true});
  close.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true);
  document.getElementById("outside")!.focus();
  expect(document.activeElement).toBe(close);
  close.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(rows[1]!.querySelector('button'));
});

it("binds explicit search and type controls only to the named table across nested sections", () => {
  document.body.innerHTML = `<main><input data-prototype-search="docs" type="search"><select data-prototype-filter="docs" data-prototype-column="type"><option>全部类型</option><option>PDF</option></select><section><table data-prototype-table="docs"><thead><tr><th>名称</th><th data-prototype-column="type">格式</th></tr></thead><tbody><tr><td>PDF 课程</td><td data-prototype-column="type">Word</td></tr><tr><td>访谈</td><td data-prototype-column="type">PDF</td></tr></tbody></table></section><table data-prototype-table="other"><tbody><tr><td>其他资料</td></tr></tbody></table></main>`;
  new Function(PROTOTYPE_TABLE_INTERACTIONS)();
  const select=document.querySelector("select")!;
  select.value="PDF";select.dispatchEvent(new Event("change",{bubbles:true}));
  expect(document.querySelectorAll<HTMLElement>('table[data-prototype-table="docs"] tbody tr')[0]!.style.display).toBe("none");
  expect(document.querySelectorAll<HTMLElement>('table[data-prototype-table="docs"] tbody tr')[1]!.style.display).toBe("");
  expect(document.querySelector<HTMLElement>('table[data-prototype-table="other"] tr')!.style.display).toBe("");
});
