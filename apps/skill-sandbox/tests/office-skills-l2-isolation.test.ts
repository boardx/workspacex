/**
 * F979(design-delta skill-office-docs-node-runtime)—— L2 进程层隔离,专门针对
 * 三个新增预装库(docx/exceljs/pdf-lib)。
 *
 * ⚠ 为什么不是把 `execute-script-isolation.test.ts` 的 V2-a 四条断言原样复制
 * 三份(一份一个库):`execute-script.ts` 的 L2 隔离机制(`--experimental-permission`
 * 的读写授权集合)完全通用,不因加载了哪个 npm 模块而改变——真正**值得单独测**的
 * 不是"这套机制还工作"(那已经被 V2-a 覆盖了),而是"这三个新库各自的依赖链会不会
 * **意外触发**一个 V2-a 没预料到的越界操作"。这是真实存在的风险,不是走过场:
 *
 *   - `exceljs` 的依赖 `tmp`(临时文件/目录创建库)默认写向 `os.tmpdir()`,如果它
 *     不是走 `process.env.SKILL_SANDBOX_OUT_DIR`,而是自己算一个跟 outdir 不同的
 *     临时路径,那次写入本该被拒——如果没被拒,说明权限模型出现了意料之外的漏洞。
 *   - `pdf-lib` 内置标准字体,理论上不该有任何文件系统访问;`@pdf-lib/fontkit`
 *     这类扩展字体加载器如果被误引入,会尝试读取字体文件——不在授权范围内。
 *   - `docx` 打包成 zip(内部用 jszip),同样不该触发任何越界写。
 *
 * ⇒ 单独开一个文件,但**不**每个库四条断言全複制:只挑对每个库风险最高的
 *   1-2 条场景("这个库的真实使用脚本,在尝试越界时,依然被同一套机制挡住"),
 *   把"机制本身还工作"这件通用的事留给 V2-a,避免 3× 冗余复製。这个取舍本身
 *   写在这里存档,不是遗漏。
 */
import { describe, expect, it } from "vitest";
import { executeScript } from "../src/execute-script.js";
import { flatModulesDir } from "./support/flat-modules.js";

const TIMEOUT_MS = 60_000;

describe("F979 L2:三个新库各自的真实脚本,越界操作依然被同一套权限模型挡住", () => {
  it("docx: writing the real .docx into outdir succeeds, writing anywhere else does not", async () => {
    const result = await executeScript({
      script: `
        const { Document, Packer, Paragraph } = require('docx');
        const fs = require('fs');
        const doc = new Document({ sections: [{ children: [new Paragraph('ok')] }] });
        Packer.toBuffer(doc).then((buf) => {
          // 合法写入:outdir 内。
          fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/ok.docx', buf);
          // 越界写入:workdir 之外的任意路径,必须被拒——docx/jszip 内部不应该、
          // 也不能绕过这一层。
          try { fs.writeFileSync('/tmp/skill-sandbox-docx-should-not-exist', buf); console.log('ESCAPED'); }
          catch (e) { console.log('DENIED:' + e.code); }
        }).catch((e) => { console.error(e.stack); process.exit(1); });
      `,
      timeoutMs: TIMEOUT_MS,
      preinstalledModulesDir: await flatModulesDir(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("DENIED:ERR_ACCESS_DENIED");
    expect(result.stdout).not.toContain("ESCAPED");
    expect(result.files.some((f) => f.name === "ok.docx")).toBe(true);
  }, TIMEOUT_MS);

  it("exceljs: its 'tmp' dependency cannot smuggle a write outside outdir", async () => {
    // ⚠ 这条专门盯 exceljs → tmp 这条依赖链。真实使用 exceljs 写一份 workbook 到
    // outdir 之外一个看起来"合法"的路径(用 exceljs 自己的 API,不是裸 fs)。
    const result = await executeScript({
      script: `
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet('s').addRow(['x']);
        wb.xlsx.writeFile('/tmp/skill-sandbox-xlsx-should-not-exist.xlsx')
          .then(() => console.log('ESCAPED'))
          .catch((e) => console.log('DENIED:' + (e.code || e.message)));
      `,
      timeoutMs: TIMEOUT_MS,
      preinstalledModulesDir: await flatModulesDir(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("ESCAPED");
    expect(result.stdout).toContain("DENIED:");
  }, TIMEOUT_MS);

  it("pdf-lib: producing a PDF with the built-in standard font touches no filesystem outside outdir", async () => {
    // pdf-lib 的 StandardFonts 是内置度量数据,不读任何字体文件——这条断言的是
    // "正常合法用法本身就不需要任何额外读权限",顺带证明脚本仍然只能写 outdir。
    const result = await executeScript({
      script: `
        const { PDFDocument, StandardFonts } = require('pdf-lib');
        const fs = require('fs');
        (async () => {
          const doc = await PDFDocument.create();
          const font = await doc.embedFont(StandardFonts.Helvetica);
          const page = doc.addPage();
          page.drawText('ok', { font, size: 12 });
          const bytes = await doc.save();
          fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/ok.pdf', bytes);
          try { fs.writeFileSync('/tmp/skill-sandbox-pdf-should-not-exist', bytes); console.log('ESCAPED'); }
          catch (e) { console.log('DENIED:' + e.code); }
        })().catch((e) => { console.error(e.stack); process.exit(1); });
      `,
      timeoutMs: TIMEOUT_MS,
      preinstalledModulesDir: await flatModulesDir(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("DENIED:ERR_ACCESS_DENIED");
    expect(result.stdout).not.toContain("ESCAPED");
    expect(result.files.some((f) => f.name === "ok.pdf")).toBe(true);
  }, TIMEOUT_MS);

  it("V1-CP 反证:三个库各自都真的不能起子进程", async () => {
    for (const [lib, requireLine] of [
      ["docx", "require('docx')"],
      ["exceljs", "require('exceljs')"],
      ["pdf-lib", "require('pdf-lib')"],
    ] as const) {
      const result = await executeScript({
        script: `
          ${requireLine};
          try { require('child_process').execSync('id'); console.log('SPAWNED'); }
          catch (e) { console.log('DENIED:' + e.code); }
        `,
        timeoutMs: TIMEOUT_MS,
        preinstalledModulesDir: await flatModulesDir(),
      });
      expect(result.stdout, `${lib}: child_process should still be denied`).toContain("DENIED:ERR_ACCESS_DENIED");
      expect(result.stdout).not.toContain("SPAWNED");
    }
  }, TIMEOUT_MS * 3);
});
