/**
 * 中文 PDF（2026-09-06 人类反馈：「excel/pdf/word/ppt 都要很好地支持中英文」）。
 *
 * ## 为什么这条必须跑在**容器里**，不能像 `produces-real-pdf.test.ts` 那样直接
 * ## 在宿主上调 `executeScript`
 *
 * 被测的东西不是"某段 JS 会不会跑"，而是**镜像里到底有没有那份 CJK 字体**、
 * 沙箱有没有把它的路径授权+传进脚本。这三件事全都是镜像/服务的属性，宿主上
 * 根本不存在（macOS 上没有 DroidSansFallbackFull.ttf，Linux CI 上也未必有）。
 * 在宿主上"用系统里随便找一个中文字体"来测，测的是那台机器，不是我们发的镜像。
 *
 * ## 断言为什么不是"文件大小 > 0"，也不是 `textRuns` 里能读到中文
 *
 * pdf-lib 嵌入自定义字体走 Identity-H：content stream 里的 `Tj` 操作数是**字形
 * 编号**，不是字符，而且 pdf-lib **不写 ToUnicode CMap**（实测确认，不是从规范
 * 推的），所以从 PDF 里反查不回"中"这个字。真正要证明的事其实是两条：
 *   ① 这些汉字在嵌入的字体里**有真字形**（glyph id ≠ 0；id 0 是 .notdef，
 *      也就是用户会看到的那个方框/空白——正是本次要修的症状本身）；
 *   ② 那些字形编号**真的被画进了页面**的 content stream。
 * 脚本把 `font.encodeText(...)` 的结果打到 stdout，测试这边比对页面里画的字节，
 * 两条一起断言。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { inspectPdf } from "../src/inspect-pdf.js";

const execFileAsync = promisify(execFile);

const IMAGE = "workspacex-skill-sandbox:test";
const SUFFIX = `${process.pid}-${Date.now()}-cjk`;

const CJK_TEXT = "季度经营回顾";
const MIXED_TEXT = "营收同比增长 18% (mixed English)";

/** SKILL.md（`office-docs-skill-content.ts`）里教的那段形状，逐字同构。 */
const CJK_PDF_SCRIPT = `
const { PDFDocument } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');

(async () => {
  const fontPath = process.env.SKILL_SANDBOX_CJK_FONT;
  if (!fontPath) throw new Error('SKILL_SANDBOX_CJK_FONT not set');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(fontPath), { subset: true });

  const page = doc.addPage([595, 842]);
  page.drawText(${JSON.stringify(CJK_TEXT)}, { x: 50, y: 780, size: 24, font });
  page.drawText(${JSON.stringify(MIXED_TEXT)}, { x: 50, y: 745, size: 12, font });

  fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/report.pdf', await doc.save());
  console.log('CJK_GLYPHS:' + font.encodeText(${JSON.stringify(CJK_TEXT)}).toString());
})().catch((e) => { console.error(e.stack); process.exit(1); });
`;

/** 反证用：拿内置标准字体画同样的中文——必须失败，不许"看起来成功"。 */
const STANDARD_FONT_SCRIPT = `
const { PDFDocument, StandardFonts } = require('pdf-lib');
const fs = require('fs');
(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText(${JSON.stringify(CJK_TEXT)}, { x: 50, y: 780, size: 24, font });
  fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/bad.pdf', await doc.save());
  console.log('WROTE_WITH_STANDARD_FONT');
})().catch((e) => { console.error(e.stack); process.exit(1); });
`;

async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["info"], { timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

const HAS_DOCKER = await dockerAvailable();
const describeDocker = HAS_DOCKER ? describe : describe.skip;

describeDocker("沙箱能产出真正带中文字形的 PDF", () => {
  const created: string[] = [];
  let container = "";

  beforeAll(async () => {
    await execFileAsync("docker", ["build", "-t", IMAGE, "."], {
      cwd: join(import.meta.dirname, ".."),
      timeout: 900_000,
    });
    container = `wsx-sandbox-cjk-${SUFFIX}`;
    await execFileAsync(
      "docker",
      [
        // L1 参数与 docker-compose.sandbox.yml 同构（network:none 也一起带上——
        // 中文字体是**预装**的，不需要出网，这条同时证明了这一点）。
        "run", "-d", "--name", container,
        "--network", "none",
        "--read-only",
        "--user", "node",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m,mode=1777",
        "--tmpfs", "/run/sandbox:rw,noexec,nosuid,size=8m,mode=0770,uid=1000,gid=1000",
        "--memory", "1g",
        "--pids-limit", "128",
        "-e", "SKILL_SANDBOX_SOCKET=/run/sandbox/skill-sandbox.sock",
        "-e", "SKILL_SANDBOX_MODULES_DIR=/opt/sandbox/node_modules",
        IMAGE,
      ],
      { timeout: 300_000 },
    );
    created.push(container);
    await waitForReady(container);
  }, 1_200_000);

  afterAll(async () => {
    for (const name of created) {
      await execFileAsync("docker", ["rm", "-f", name], { timeout: 60_000 }).catch(() => undefined);
    }
  }, 300_000);

  it("draws Chinese with real glyphs from the preinstalled font, offline", async () => {
    const result = await postRun(container, CJK_PDF_SCRIPT);
    expect(result.stderr, `sandbox stderr:\n${result.stderr}`).toBe("");
    expect(result.exitCode).toBe(0);

    const glyphHex = /CJK_GLYPHS:<([0-9A-Fa-f]+)>/.exec(result.stdout)?.[1];
    expect(glyphHex, `stdout:\n${result.stdout}`).toBeTruthy();

    // ① 每个汉字都有真字形：Identity-H 下每个字形编号占 2 字节，编号 0 = .notdef
    //    （用户看到的方框）。有任何一个是 0 就说明这份字体不覆盖中文。
    const ids: number[] = [];
    for (let i = 0; i < glyphHex!.length; i += 4) ids.push(parseInt(glyphHex!.slice(i, i + 4), 16));
    expect(ids).toHaveLength(CJK_TEXT.length);
    expect(ids.filter((id) => id === 0)).toEqual([]);

    const file = result.files.find((f) => f.name === "report.pdf");
    expect(file, `files: ${result.files.map((f) => f.name).join(",")}`).toBeTruthy();
    const bytes = Buffer.from(file!.contentBase64, "base64");

    const inspection = await inspectPdf(bytes);
    expect(inspection.pageCount).toBe(1);

    // ② 那些字形编号真的被画进了 content stream。inspectPdf 把 Tj/TJ 的操作数按
    //    latin1 还原成字节串，这里转回 hex 与脚本报的编码比对。
    const drawn = inspection.textRuns.map((run) => Buffer.from(run, "latin1").toString("hex").toUpperCase());
    expect(drawn).toContain(glyphHex!.toUpperCase());

    // ③ 字体真的**嵌**进了文件，不是只写了个字体名字指望阅读器自己有——那正是
    //    换台机器就变方框的经典坏法。Identity-H 是内嵌子集字体的编码方式。
    expect(inspection.embeddedFontFileCount).toBeGreaterThan(0);
    expect(inspection.fontEncodings).toContain("Identity-H");
  }, 300_000);

  it("counterproof: the built-in standard font still cannot draw the same Chinese", async () => {
    const result = await postRun(container, STANDARD_FONT_SCRIPT);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("WROTE_WITH_STANDARD_FONT");
    // WinAnsi 编码器对非拉丁字符抛错——证明上面那条测试测的是"嵌入字体这条路"，
    // 不是"随便画点什么都能过"。
    expect(result.stderr).toMatch(/WinAnsi|cannot encode|0x[0-9a-fA-F]+/);
  }, 300_000);
});

async function waitForReady(containerName: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      await postRun(containerName, "console.log('ready')");
      return;
    } catch (e) {
      if (Date.now() > deadline) {
        const logs = await execFileAsync("docker", ["logs", containerName]).catch(() => ({
          stdout: "",
          stderr: "<no logs>",
        }));
        throw new Error(
          `sandbox container ${containerName} never became ready: ${(e as Error).message}\n${logs.stdout}${logs.stderr}`,
        );
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

interface RunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly files: readonly { name: string; contentBase64: string; sizeBytes: number }[];
}

/** 与 `office-skills-container-network-isolation.test.ts` 同一份实现（照抄，不重新发明）。 */
async function postRun(containerName: string, script: string): Promise<RunResult> {
  const client = `
    const http = require('http');
    const script = Buffer.from(process.env.PROBE_B64, 'base64').toString('utf8');
    const payload = JSON.stringify({ script, timeoutMs: 60000 });
    const req = http.request({
      socketPath: process.env.SKILL_SANDBOX_SOCKET, path: '/run', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) { console.error('STATUS ' + res.statusCode + ' ' + body); process.exit(9); }
        process.stdout.write(body);
      });
    });
    req.on('error', (e) => { console.error(e.message); process.exit(8); });
    req.end(payload);
  `;

  const { stdout } = await execFileAsync(
    "docker",
    [
      "exec",
      "-e", `PROBE_B64=${Buffer.from(script, "utf8").toString("base64")}`,
      containerName,
      "node", "-e", client,
    ],
    { timeout: 180_000, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as RunResult;
}
