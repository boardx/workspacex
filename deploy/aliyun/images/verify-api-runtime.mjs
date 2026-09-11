import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { AnydocAttachmentToMarkdown } from "/opt/workspacex/apps/api/src/infrastructure/chat/anydoc-attachment-to-markdown.ts";
assert.equal(process.getuid(), 1000, "API image must run as node user");
const converter = new AnydocAttachmentToMarkdown();
const csv = await converter.convert(Buffer.from("name,value\nrelease,42\n"), "csv");
assert.equal(csv.ok, true);
assert.match(csv.markdown, /release/);
// Independent PDF generation checks actual native PDF extraction, not an import-only smoke.
const { PDFDocument, StandardFonts } = createRequire("/opt/workspacex/apps/skill-sandbox/package.json")("pdf-lib");
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage().drawText("Cloud release fixture", { x: 40, y: 700, font });
const result = await converter.convert(await pdf.save(), "pdf");
assert.equal(result.ok, true);
assert.match(result.markdown, /Cloud release fixture/);
process.stdout.write("API image: non-root runtime, native CSV and PDF attachment extraction passed\n");
