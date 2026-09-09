/** Export the same sanitized document the reader sees, including draft notices. */
export async function buildResearchWord(root: HTMLElement): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, Table, TableRow, TableCell, Footer, PageNumber, AlignmentType } = await import("docx");
  type Inline = InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>;
  function inline(node: Node, style: { bold?: boolean; italics?: boolean; superScript?: boolean } = {}): Inline[] {
    if (node.nodeType === Node.TEXT_NODE) return [new TextRun({ text: node.textContent ?? "", ...style })];
    if (!(node instanceof HTMLElement)) return [];
    const next = { ...style, ...(["STRONG", "B"].includes(node.tagName) ? { bold: true } : {}), ...(node.tagName === "EM" ? { italics: true } : {}), ...(node.tagName === "SUP" ? { superScript: true } : {}) };
    if (["UL", "OL"].includes(node.tagName)) return [];
    if (node.tagName === "BR") return [new TextRun({ break: 1 })];
    const children = Array.from(node.childNodes).flatMap((child) => inline(child, next));
    const href = node.getAttribute("href");
    if (node.tagName === "A" && href && /^https?:\/\//i.test(href)) return [new ExternalHyperlink({ link: href, children })];
    return node.tagName === "P" ? [...children, new TextRun({ break: 1 })] : children;
  }
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  const headings: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = { H2: HeadingLevel.TITLE, H3: HeadingLevel.HEADING_1, H4: HeadingLevel.HEADING_2, H5: HeadingLevel.HEADING_3, H6: HeadingLevel.HEADING_4 };
  function paragraph(runs: Inline[], heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel], bullet?: number) {
    children.push(new Paragraph({ children: runs, ...(heading ? { heading, keepNext: true } : {}), ...(bullet === undefined ? {} : { bullet: { level: Math.min(bullet, 8) } }), spacing: { after: 160, line: 360 } }));
  }
  function visit(element: Element, level = 0) {
    if (element.tagName === "NAV") return;
    if (element.tagName === "TABLE") {
      children.push(new Table({ rows: Array.from(element.querySelectorAll("tr")).map((row) => new TableRow({ children: Array.from(row.children).map((cell) => new TableCell({ children: [new Paragraph({ children: inline(cell), spacing: { after: 100 } })] })) })) }));
    } else if (element.tagName === "LI") {
      let runs: Inline[] = []; let first = true;
      const flush = () => {
        if (!runs.length) return;
        const ordered = element.parentElement?.tagName === "OL";
        paragraph([...(first && ordered ? [new TextRun(`${Array.from(element.parentElement!.children).indexOf(element) + 1}. `)] : []), ...runs], undefined, first && !ordered ? level : undefined);
        runs = []; first = false;
      };
      for (const child of Array.from(element.childNodes)) {
        if (child instanceof HTMLElement && ["UL", "OL", "PRE", "TABLE", "P"].includes(child.tagName)) {
          flush();
          if (child.tagName === "P") { runs = Array.from(child.childNodes).flatMap((item) => inline(item)); flush(); }
          else visit(child, ["UL", "OL"].includes(child.tagName) ? level + 1 : level);
        } else runs.push(...inline(child));
      }
      flush();
    } else if (element.tagName === "PRE") {
      paragraph((element.textContent ?? "").split("\n").map((line, index) => new TextRun({ text: line, font: "Courier New", ...(index ? { break: 1 } : {}) })));
    } else if (headings[element.tagName] || element.tagName === "P") {
      paragraph(inline(element), headings[element.tagName]);
    } else {
      for (const child of Array.from(element.children)) visit(child, level);
    }
  }
  visit(root);
  return Packer.toBlob(new Document({ styles: { default: { document: { run: { font: "Arial Unicode MS", size: 22 } } } }, sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) } }] }));
}
export async function downloadResearchWord(root: HTMLElement, title: string) {
  const blob = await buildResearchWord(root); const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `${title.replace(/[\\/:*?"<>|]/g, "-") || "研究报告"}.docx`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Native PDF preserves Chinese text, selectable text, links and pagination. */
export function printResearchPdf(root: HTMLElement) {
  const frame = document.createElement("iframe"); frame.title = "研究报告 PDF"; frame.style.cssText = "position:fixed;width:0;height:0;border:0"; document.body.append(frame);
  const target = frame.contentDocument; const view = frame.contentWindow;
  if (!target || !view) { frame.remove(); throw new Error("Print unavailable"); }
  const style = target.createElement("style"); style.textContent = "@page{size:A4;margin:20mm}body{font:11pt/1.8 sans-serif;color:#111}h2{font-size:22pt}h3{font-size:16pt}h4{font-size:13pt}h2,h3,h4,h5{break-after:avoid}p{orphans:3;widows:3}a{color:inherit;overflow-wrap:anywhere}sup{font-size:8pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6pt}nav{display:none}li{margin-bottom:6pt}section{margin-top:18pt}";
  target.head.append(style); target.body.append(target.importNode(root, true)); target.title = root.querySelector("h2")?.textContent ?? "研究报告";
  view.addEventListener("afterprint", () => frame.remove(), { once: true });
  // Give the isolated document one frame to lay out before printing.
  view.requestAnimationFrame(() => { view.focus(); view.print(); });
}
