/** Trusted, self-contained local table interactions. Used inside the existing
 * nonce bridge in both live preview and HTML export; never runs model code. */
function tableInteractions(): void {
  // Empty value and these exact reserved values mean no filter. Prefixes are
  // ordinary data (for example Allan or Anything), never an all-items command.
  const isAllOption = (option: HTMLOptionElement | undefined) => option !== undefined &&
    (option.value.trim() === "" || /^(全部|所有|全部类型|所有类型|all|any|all types|any type)$/i.test(option.value.trim()));
  const tables = Array.from(document.querySelectorAll("table"));
  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr")).filter((row) => row.querySelector("td"));
    if (!rows.length) continue;
    const scope = table.closest("main, section, article") ?? document.body;
    const tableId = table.getAttribute("data-prototype-table");
    const bound = (element: Element, attribute: string) => {
      const target = element.getAttribute(attribute);
      return target !== null ? target === tableId : !tableId;
    };
    const searches = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-prototype-search], input[type="search"], input[placeholder*="搜索"], input[placeholder*="Search"], input[placeholder*="search"]'))
      .filter((input) => bound(input, "data-prototype-search") && (input.hasAttribute("data-prototype-search") || scope.contains(input)));
    const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th"));
    const typeIndex = headers.findIndex((header) => /^(类型|资料类型|文件类型|type|file type)$/i.test(header.textContent?.trim() ?? ""));
    const typeValues = new Set(rows.map((row) => row.cells[typeIndex]?.textContent?.trim().toLocaleLowerCase()).filter(Boolean));
    const filters = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).flatMap<{ select: HTMLSelectElement; column: string | null; index: number }>((select) => {
      if (!bound(select, "data-prototype-filter") || (!select.hasAttribute("data-prototype-filter") && !scope.contains(select))) return [];
      const column = select.getAttribute("data-prototype-column");
      const explicit = select.hasAttribute("data-prototype-filter");
      const index = column ? headers.findIndex((header) => header.getAttribute("data-prototype-column") === column) : typeIndex;
      if (explicit) return column && (index >= 0 || rows.some((row) => Array.from(row.cells).some((cell) => cell.getAttribute("data-prototype-column") === column))) ? [{ select, column, index }] : [];
      // Legacy prototypes: infer only an actual type selector whose options all
      // match the type column. Sort/owner controls must never become filters.
      const options = Array.from(select.options).filter((option) => !isAllOption(option)).map((option) => option.textContent?.trim().toLocaleLowerCase() ?? "").filter(Boolean);
      return typeIndex >= 0 && options.length && options.every((value) => typeValues.has(value)) ? [{ select, column: null, index: typeIndex }] : [];
    });
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    table.after(status);
    const apply = () => {
      let count = 0;
      for (const row of rows) {
        const content = (row.textContent ?? "").toLocaleLowerCase();
        const show = searches.every((input) => content.includes(input.value.trim().toLocaleLowerCase())) && filters.every(({ select, column, index }) => {
          const option = select.selectedOptions[0];
          const value = (option?.textContent ?? select.value).trim();
          const cell = column ? Array.from(row.cells).find((cell) => cell.getAttribute("data-prototype-column") === column) ?? row.cells[index] : row.cells[index];
          return isAllOption(option) || cell?.textContent?.trim().toLocaleLowerCase() === value.toLocaleLowerCase();
        });
        row.style.display = show ? "" : "none";
        if (show) count++;
      }
      status.textContent = count ? `共 ${count} 条资料` : "没有匹配的资料，请调整搜索或筛选条件";
    };
    searches.forEach((input) => input.addEventListener("input", apply));
    filters.forEach(({ select }) => select.addEventListener("change", apply));
    table.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const button = target?.closest("button, a");
      if (!button || target?.closest("[data-goto]") || !/^(打开|查看|open|view)$/i.test(button.textContent?.trim() ?? "")) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const row = button.closest("tr");
      if (!row) return;
      event.preventDefault();
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-label", "资料详情预览");
      dialog.style.cssText = "position:fixed;inset:15%;z-index:9999;padding:24px;background:white;color:#111;border:1px solid #ccc;border-radius:12px;box-shadow:0 0 0 100vmax #0008;overflow:auto";
      const title = document.createElement("h2");
      title.textContent = "资料详情预览";
      dialog.append(title);
      Array.from(row.querySelectorAll("td")).forEach((cell) => {
        if (cell.contains(button)) return;
        const paragraph = document.createElement("p");
        paragraph.textContent = cell.textContent;
        dialog.append(paragraph);
      });
      const close = document.createElement("button");
      close.textContent = "关闭";
      const keepFocus = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) close.focus(); };
      const dismiss = () => { document.removeEventListener("focusin", keepFocus); dialog.remove(); (button as HTMLElement).focus(); };
      close.onclick = dismiss;
      dialog.addEventListener("keydown", (e) => {
        if (e.key === "Escape") dismiss();
        if (e.key === "Tab") { e.preventDefault(); close.focus(); }
      });
      dialog.append(close);
      document.body.append(dialog);
      document.addEventListener("focusin", keepFocus);
      close.focus();
    });
    if (searches.length || filters.length) apply();
  }
}
export const PROTOTYPE_TABLE_INTERACTIONS = `(${tableInteractions.toString()})();`;
