import test from 'node:test';
import assert from 'node:assert/strict';
import { hasExactSavedInput } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';
import { assertPrintDocument, pdfStructure } from '../../apps/web/e2e/support/devapp-aidt-print-evidence.mjs';
const projectId = 'prj-11111111-1111-4111-8111-111111111111';
const nonce = 'synthetic-print-intent';
const document = () => ({ nonce, projectId, ownerPath: `/aidt/${projectId}`, frameTitle: '研究报告 PDF', beforeprintSeen: true, html: `<html><head><style>body{font:11pt sans-serif}</style></head><body><article><h2>合成测试清单</h2><p>仅软件流程验收，不代表真实采访。</p></article></body></html>`, text: '合成测试清单\n仅软件流程验收，不代表真实采访。', images: [], unsafeNodes: 0, unsafeAttributes: false, externalStyles: false });
test('print document identity is tied to the current owned project and exact print intent', () => {
  const intent = { projectId, nonce, requiredTexts: ['合成测试清单', '不代表真实采访'] };
  assert.equal(assertPrintDocument(document(), intent).imageCount, 0);
  for (const delta of [{ projectId: 'foreign' }, { nonce: 'previous-intent' }, { ownerPath: '/aidt' }, { frameTitle: 'other frame' }, { beforeprintSeen: false }]) assert.throws(() => assertPrintDocument({ ...document(), ...delta }, intent), /PRINT_DOCUMENT_SCOPE_REJECTED/);
});
test('missing text, unsafe nodes/handlers/style URLs and absent safety observations cannot pass', () => {
  for (const delta of [{ text: 'different document with enough characters' }, { unsafeNodes: 1 }, { unsafeAttributes: true }, { externalStyles: true }, { unsafeNodes: undefined }]) assert.throws(() => assertPrintDocument({ ...document(), ...delta }, { projectId, nonce, requiredTexts: ['合成测试清单'] }), /PRINT_DOCUMENT_/);
});
test('print images must be completely decoded and match the registered synthetic fixture bytes', () => {
  const hash = 'a'.repeat(64), row = { complete: true, width: 240, height: 120, sha256: hash };
  assert.equal(assertPrintDocument({ ...document(), images: [row] }, { projectId, nonce, imageHashes: [hash] }).imageCount, 1);
  assert.throws(() => assertPrintDocument(document(), { projectId, nonce, imageHashes: [hash] }), /PRINT_DOCUMENT_IMAGE_UNVERIFIED/);
  assert.throws(() => assertPrintDocument({ ...document(), images: [row, row] }, { projectId, nonce, imageHashes: [hash] }), /PRINT_DOCUMENT_IMAGE_UNVERIFIED/);
  for (const delta of [{ complete: false }, { width: 0 }, { sha256: 'b'.repeat(64) }]) assert.throws(() => assertPrintDocument({ ...document(), images: [{ ...row, ...delta }] }, { projectId, nonce, imageHashes: [hash] }), /PRINT_DOCUMENT_IMAGE_UNVERIFIED/);
});
test('PDF byte structural guard rejects HTML, truncation, empty and excessive page sets; it is not a glyph proof', () => {
  const fixture = Buffer.from(`%PDF-1.7\n${' '.repeat(600)}\n1 0 obj << /Type /Page /Parent 2 0 R >> endobj\n%%EOF`);
  assert.equal(pdfStructure(fixture).pageCount, 1);
  for (const bytes of [Buffer.from('<html>not a PDF</html>'), fixture.subarray(0, 400), Buffer.from(`%PDF-1.7\n${' '.repeat(600)}\n%%EOF`), Buffer.from(`%PDF-1.7\n${' /Type /Page '.repeat(61)}\n%%EOF`)]) assert.throws(() => pdfStructure(bytes), /PRINT_PDF_/);
});

test('a real saved input revision must contain the exact new value, including encoded entity payloads', () => {
  const newInput = '合成观察中保留时间情境差异';
  assert.equal(hasExactSavedInput({ draft: { fields: { entity: JSON.stringify({ payload: { fields: { hypothesis: newInput } } }) } } }, newInput), true);
  assert.equal(hasExactSavedInput({ draft: { fields: { text: `prefix ${newInput}` } } }, newInput), false);
  assert.equal(hasExactSavedInput({ draft: { fields: { text: 'old draft unchanged' } } }, newInput), false);
  assert.equal(hasExactSavedInput({ malformed: '[not json' }, newInput), false);
});
