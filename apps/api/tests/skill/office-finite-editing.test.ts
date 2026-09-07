import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Document, Header, Packer, Paragraph, Table, TableCell, TableRow } from "docx";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { afterEach, describe, expect, it } from "vitest";
import { unzip } from "@repo/skill-sandbox/ooxml";

const run = promisify(execFile);
const resources = resolve(import.meta.dirname, "../../scripts/office-package-resources");
const roots: string[] = [];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const entries = (bytes: Buffer) => new Map(unzip(bytes).map(entry => [entry.name, entry.bytes]));
async function temp() { const root = await mkdtemp(join(tmpdir(), "office-edit-")); roots.push(root); return root; }
async function missing(path: string) { try { await stat(path); return false; } catch { return true; } }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("S003-S005 finite Office editing", () => {
  it("S003 replaces one Word text node while preserving header, table, relationships and unrelated ZIP bytes", async () => {
    const root = await temp(), input = join(root, "source.docx"), output = join(root, "edited.docx");
    const doc = new Document({ sections: [{
      headers: { default: new Header({ children: [new Paragraph("KEEP HEADER") ] }) },
      children: [new Paragraph("TARGET OLD"), new Paragraph("KEEP PARAGRAPH"), new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("KEEP TABLE") ] })] })] })],
    }] });
    const docxBytes = await Packer.toBuffer(doc);
    await import("node:fs/promises").then(fs => fs.writeFile(input, docxBytes));
    const result = await run("python3", [join(resources, "edit-ooxml.py"), input, output, "word/document.xml", "TARGET OLD", "目标新文本"]);
    expect(JSON.parse(result.stdout).preservation).toBe("all_other_zip_entry_bytes_identical");
    const before = entries(await readFile(input)), after = entries(await readFile(output));
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(hash(after.get(name)!)).toBe(hash(bytes));
    const changed = after.get("word/document.xml")!.toString("utf8");
    expect(changed).toContain("目标新文本"); expect(changed).toContain("KEEP PARAGRAPH"); expect(changed).toContain("KEEP TABLE");
    expect(hash(after.get("word/header1.xml")!)).toBe(hash(before.get("word/header1.xml")!));
    expect(hash(after.get("word/_rels/document.xml.rels")!)).toBe(hash(before.get("word/_rels/document.xml.rels")!));
  });

  it("S003 rejects a listed unsupported Word object without creating an output", async () => {
    const root = await temp(), input = join(root, "unsupported.docx"), output = join(root, "edited.docx");
    const zip = new JSZip();
    zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>TARGET OLD</w:t></w:r><w:object/></w:p></w:body></w:document>');
    await import("node:fs/promises").then(async fs => fs.writeFile(input, await zip.generateAsync({ type: "nodebuffer" })));
    await expect(run("python3", [join(resources, "edit-ooxml.py"), input, output, "word/document.xml", "TARGET OLD", "new"])).rejects.toMatchObject({ stderr: expect.stringContaining("OFFICE_EDIT_UNSUPPORTED_OBJECT") });
    expect(await missing(output)).toBe(true);
  });

  it("S004 changes one literal cell, preserves other sheet/style/formula, and reports recalculation as pending", async () => {
    const root = await temp(), input = join(root, "source.xlsx"), output = join(root, "edited.xlsx");
    const workbook = new ExcelJS.Workbook(), data = workbook.addWorksheet("Data"), other = workbook.addWorksheet("Other");
    data.getCell("A1").value = 1; data.getCell("B2").value = "KEEP STYLE"; data.getCell("B2").font = { bold: true, color: { argb: "FF336699" } };
    other.getCell("A1").value = "KEEP SHEET"; other.getCell("C1").value = { formula: "Data!A1*2", result: 2 };
    await workbook.xlsx.writeFile(input); const font = JSON.stringify(data.getCell("B2").font);
    const result = await run("node", [join(resources, "edit-xlsx.cjs"), input, output, "Data", "A1", "7"], { env: { ...process.env, NODE_PATH: resolve(process.cwd(), "../skill-sandbox/node_modules") } });
    expect(JSON.parse(result.stdout).recalculation).toBe("requested_on_open_not_performed");
    const edited = new ExcelJS.Workbook(); await edited.xlsx.readFile(output);
    expect(edited.getWorksheet("Data")!.getCell("A1").value).toBe(7);
    expect(edited.getWorksheet("Other")!.getCell("A1").value).toBe("KEEP SHEET");
    expect(edited.getWorksheet("Other")!.getCell("C1").value).toEqual({ formula: "Data!A1*2", result: 2 });
    expect(JSON.stringify(edited.getWorksheet("Data")!.getCell("B2").font)).toBe(font);
    const workbookXml = entries(await readFile(output)).get("xl/workbook.xml")!.toString("utf8");
    expect(workbookXml).toMatch(/fullCalcOnLoad="1"/);
  });

  it("S004 rejects unsupported workbook drawings before producing bytes", async () => {
    const root = await temp(), input = join(root, "drawing.xlsx"), output = join(root, "edited.xlsx");
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Data"); sheet.getCell("A1").value = 1;
    const image = workbook.addImage({ base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", extension: "png" });
    sheet.addImage(image, "B2:C3"); await workbook.xlsx.writeFile(input);
    await expect(run("node", [join(resources, "edit-xlsx.cjs"), input, output, "Data", "A1", "7"], { env: { ...process.env, NODE_PATH: resolve(process.cwd(), "../skill-sandbox/node_modules") } })).rejects.toMatchObject({ stderr: expect.stringContaining("OFFICE_EDIT_UNSUPPORTED_OBJECT") });
    expect(await missing(output)).toBe(true);
  });

  it("S005 replaces one slide text node while preserving pictures and all unrelated ZIP bytes", async () => {
    const root = await temp(), input = join(root, "source.pptx"), output = join(root, "edited.pptx");
    const pptx = new PptxGenJS(); const first = pptx.addSlide(); first.addText("TARGET OLD", { x: 1, y: 1, w: 4, h: 1 });
    first.addImage({ data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", x: 1, y: 3, w: 1, h: 1 });
    pptx.addSlide().addText("KEEP SLIDE", { x: 1, y: 1, w: 4, h: 1 }); await pptx.writeFile({ fileName: input });
    const result = await run("python3", [join(resources, "edit-ooxml.py"), input, output, "ppt/slides/slide1.xml", "TARGET OLD", "目标新文本"]);
    expect(JSON.parse(result.stdout).visualInspection).toBe("required");
    const before = entries(await readFile(input)), after = entries(await readFile(output));
    for (const [name, bytes] of before) if (name !== "ppt/slides/slide1.xml") expect(hash(after.get(name)!)).toBe(hash(bytes));
    expect(after.get("ppt/slides/slide1.xml")!.toString("utf8")).toContain("目标新文本");
    for (const name of [...before.keys()].filter(name => name.startsWith("ppt/media/") || name === "ppt/slides/slide2.xml" || name === "ppt/slides/_rels/slide1.xml.rels")) expect(hash(after.get(name)!)).toBe(hash(before.get(name)!));
  });
});
