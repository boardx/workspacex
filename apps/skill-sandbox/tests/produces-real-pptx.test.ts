/**
 * `verification.md` **V1**（沙箱这一端）+ **V1-CP** 反证。
 *
 * V1 的完整链路(真实模型 → 沙箱 → 真 .pptx)在 `apps/api` 侧的真栈 e2e 里跑;
 * 本文件锁的是链路中间那一段最容易被做假的地方:**沙箱真的能产出一个合法的
 * .pptx**,而不是"回了一个文件"。
 *
 * ⚠ 断言全部落在 `src/ooxml.ts`（同时被 apps/api 侧引用，单一事实源） 的真解析上(解 zip、验 central directory、
 * 解每张 slide 的 XML、读 `<a:t>`)。V1-CP 就在本文件里,同一套断言喂给
 * "回空文件"/"回垃圾字节"两种假实现,证明它们会**红**。
 */
import { describe, expect, it } from "vitest";
import { executeScript } from "../src/execute-script.js";
import { flatModulesDir } from "./support/flat-modules.js";
import { inspectPptx } from "../src/ooxml.js";

const TIMEOUT_MS = 60_000;

/**
 * 刻意写成 pptx skill 原文那种形态:`require('pptxgenjs')`(预装,不 npm install),
 * 写进 `SKILL_SANDBOX_OUT_DIR`。这就是模型将来会写出来的脚本的样子。
 */
const DECK_SCRIPT = `
const PptxGenJS = require('pptxgenjs');
const pres = new PptxGenJS();
pres.layout = 'LAYOUT_16x9';

const slides = [
  { title: '季度回顾', body: '营收同比增长 18%' },
  { title: '风险', body: '供应链交付周期拉长' },
  { title: '下一步', body: '把试跑接上真实执行' },
];

for (const s of slides) {
  const slide = pres.addSlide();
  slide.addText(s.title, { x: 0.5, y: 0.5, fontSize: 32, bold: true });
  slide.addText(s.body, { x: 0.5, y: 1.8, fontSize: 18 });
}

pres.writeFile({ fileName: process.env.SKILL_SANDBOX_OUT_DIR + '/deck.pptx' })
  .then(() => console.log('WROTE_DECK'))
  .catch((e) => { console.error(e.stack); process.exit(1); });
`;

describe("V1 沙箱产出真实 .pptx", () => {
  it("runs a pptxgenjs script against the preinstalled module and returns valid OOXML", async () => {
    const result = await executeScript({
      script: DECK_SCRIPT,
      timeoutMs: TIMEOUT_MS,
      preinstalledModulesDir: await flatModulesDir(),
    });

    // 脚本失败时把真实 stderr 摊在断言消息里——不给"莫名其妙红了"留空间。
    expect(result.stderr, `script stderr:\n${result.stderr}`).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WROTE_DECK");

    expect(result.files).toHaveLength(1);
    const file = result.files[0]!;
    expect(file.name).toBe("deck.pptx");

    const bytes = Buffer.from(file.contentBase64, "base64");
    expect(bytes.length).toBe(file.sizeBytes);

    const inspection = inspectPptx(bytes);
    expect(inspection.slideCount).toBe(3);

    const text = inspection.textRuns.filter((t) => t.trim() !== "");
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("季度回顾");
    expect(text).toContain("把试跑接上真实执行");
  }, TIMEOUT_MS);

  it("proves pptxgenjs is preinstalled rather than fetched — no module dir means an honest failure", async () => {
    // 不给 preinstalledModulesDir ⇒ 必须诚实地找不到模块,而不是偷偷去装
    // (`network: none` 下也装不了,contract §4 末尾)。
    const result = await executeScript({
      script: DECK_SCRIPT,
      timeoutMs: TIMEOUT_MS,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("MODULE_NOT_FOUND");
  }, TIMEOUT_MS);
});

describe("V1-CP 反证:V1 的断言必须能红", () => {
  it("rejects an empty file — the 'always returns 0 bytes' implementation must NOT pass", () => {
    expect(() => inspectPptx(Buffer.alloc(0))).toThrow(/no end-of-central-directory/);
  });

  it("rejects arbitrary non-zip bytes", () => {
    expect(() => inspectPptx(Buffer.from("this is definitely not a pptx", "utf8"))).toThrow(
      /no end-of-central-directory/,
    );
  });

  it("rejects a structurally valid zip that is not a presentation", async () => {
    // 真造一个 zip(用沙箱自己造,顺带再证一次执行链路可用),但里面没有
    // OOXML 的 Content_Types ⇒ 必须红。
    const result = await executeScript({
      script: `
        const { deflateRawSync } = require('zlib');
        const fs = require('fs');
        const name = Buffer.from('note.txt');
        const raw = Buffer.from('not a deck');
        const body = deflateRawSync(raw);
        const crcTable = [];
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
        let crc = 0xffffffff;
        for (const b of raw) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
        crc = (crc ^ 0xffffffff) >>> 0;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
        local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
        central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
        const cdOffset = local.length + name.length + body.length;
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
        eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
        fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/fake.pptx',
          Buffer.concat([local, name, body, central, name, eocd]));
      `,
      timeoutMs: TIMEOUT_MS,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const bytes = Buffer.from(result.files[0]!.contentBase64, "base64");
    expect(() => inspectPptx(bytes)).toThrow(/\[Content_Types\]\.xml missing/);
  }, TIMEOUT_MS);
});
