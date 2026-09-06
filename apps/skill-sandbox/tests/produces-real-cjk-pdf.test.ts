/**
 * 中文 PDF（2026-09-06 人类反馈：「excel/pdf/word/ppt 都要很好地支持中英文」）。
 *
 * ## 这份测试的第一版是**绿的，而产出的 PDF 打开是方框**
 *
 * 第一版断言「每个汉字的字形编号 != 0」（0 = .notdef = 方框）。它抓不到真实缺陷，
 * 因为 `subset: true` 会把字形**重新编号**成 1,2,3…——编号非零是恒真的，与那些字形
 * 里到底有没有轮廓无关。线上因此产出了一份 3801 字节、打开全是方框的 PDF，而门控全绿。
 * 同一天记的第二笔「全绿但空转」，就发生在我自己写的反证旁边。
 *
 * ## 现在锁的三件事（每件都能独立变红）
 *
 * ① **源字体覆盖**：样本里每个字符（中文 + 数字 + 拉丁 + 全角标点 + 生僻字）在字体里
 *   都必须有非零字形。旧字体 DroidSansFallback 就栽在这条上——它**没有拉丁字形**，
 *   'm'/'A'/'1'/'%' 全是 .notdef，任何带数字的中文文档都会画方框。
 * ② **内嵌字体真的可用**：把 PDF 里的 FontFile 掏出来重新解析，用到的每个字形都要
 *   取得到、且轮廓非空。`subset: true` 产出的字体在这一步会直接解析失败或读越界。
 * ③ **不子集化**：pdf-lib 的运行期子集器在 TrueType 与 CFF 两条路上都产出坏字体
 *   （实测三种字体，逐个渲染确认）。子集化已挪到构建期用 fontTools 做。
 *
 * 反证就是**同一段脚本加上 `subset: true`**：② 必须立刻变红。这条反证如果哪天变绿了，
 * 说明 pdf-lib 修好了它的子集器——那时才可以考虑把子集化搬回运行期，并省下几 MB。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { inspectPdf } from "../src/inspect-pdf.js";

const execFileAsync = promisify(execFile);

const IMAGE = "workspacex-skill-sandbox:test";
const SUFFIX = `${process.pid}-${Date.now()}-cjk`;

/** 中文 + 数字 + 拉丁 + 全角标点 + 两个生僻字（GB2312 之外，专门盯字符集裁得够不够）。 */
const SAMPLE = "季度经营回顾 2026 Q3 mixed English 18% （中英文）淼喆";

/** SKILL.md 里教的那段形状，逐字同构——包括**不写** subset。 */
const cjkScript = (subset: boolean) => `
const { PDFDocument } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');

(async () => {
  const fontPath = process.env.SKILL_SANDBOX_CJK_FONT;
  if (!fontPath) throw new Error('SKILL_SANDBOX_CJK_FONT not set');
  const bytes = fs.readFileSync(fontPath);

  // 覆盖自检：任何一个字符在字体里没有字形，就是"打开会看到方框"，如实报出来。
  const probe = fontkit.create(bytes);
  const missing = [...new Set(${JSON.stringify(SAMPLE)})]
    .filter((ch) => ch !== ' ' && (probe.glyphsForString(ch)[0] || {}).id === 0);
  console.log('MISSING_GLYPHS:' + missing.join(''));

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(bytes${subset ? ", { subset: true }" : ""});

  const page = doc.addPage([595, 842]);
  page.drawText(${JSON.stringify(SAMPLE)}, { x: 40, y: 780, size: 18, font });

  fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/report.pdf', await doc.save());
  // ⚠ 报**去掉空白之后**那些字符的编号：空格的字形轮廓本来就是空的（它是合法的
  //   零宽度字形，不是坏字形），混在里面会让"轮廓非空"这条判据产生一条假红。
  console.log('DRAWN_CODES:' + font.encodeText(${JSON.stringify(SAMPLE)}.replace(/\\s/g, '')).toString());
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

describeDocker("沙箱产出的中文 PDF 必须真的能读（不是「字形编号非零」）", () => {
  const created: string[] = [];
  let container = "";

  beforeAll(async () => {
    await execFileAsync("docker", ["build", "-t", IMAGE, "."], {
      cwd: join(import.meta.dirname, ".."),
      timeout: 1_800_000,
    });
    container = `wsx-sandbox-cjk-${SUFFIX}`;
    await execFileAsync(
      "docker",
      [
        "run", "-d", "--name", container,
        // network:none 一起带上——字体是预装的，不需要出网，这条同时证明了这一点。
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
  }, 2_400_000);

  afterAll(async () => {
    for (const name of created) {
      await execFileAsync("docker", ["rm", "-f", name], { timeout: 60_000 }).catch(() => undefined);
    }
  }, 300_000);

  it("① 源字体覆盖中文、数字、拉丁、全角标点与生僻字，② 内嵌字体每个用到的字形都有轮廓", async () => {
    const result = await postRun(container, cjkScript(false));
    expect(result.stderr, `sandbox stderr:\n${result.stderr}`).toBe("");
    expect(result.exitCode).toBe(0);

    // ① 一个都不许缺。缺了就是"打开看到方框"，旧字体正是死在这条上。
    const missing = /MISSING_GLYPHS:(.*)/.exec(result.stdout)?.[1] ?? "<not reported>";
    expect(missing, `字体缺这些字符的字形：${missing}`).toBe("");

    const file = result.files.find((f) => f.name === "report.pdf");
    expect(file, `files: ${result.files.map((f) => f.name).join(",")}`).toBeTruthy();
    const bytes = Buffer.from(file!.contentBase64, "base64");

    const inspection = await inspectPdf(bytes);
    expect(inspection.pageCount).toBe(1);
    expect(inspection.embeddedFontFileCount).toBeGreaterThan(0);
    expect(inspection.fontEncodings).toContain("Identity-H");

    // ② 真正的判据：内嵌字体能被重新解析，且页面上画的每个编号都对应一个有轮廓的字形。
    const codes = drawnCodes(result.stdout);
    expect(codes.length).toBe([...SAMPLE.replace(/\s/g, "")].length);
    const usable = await inspection.usableGlyphs(codes);
    expect(usable.unreadableFont, `内嵌字体解析失败：${usable.unreadableFont}`).toBeNull();
    expect(usable.brokenCodes, `这些字形在内嵌字体里取不到或没有轮廓：${usable.brokenCodes.join(",")}`)
      .toEqual([]);
  }, 300_000);

  it("反证：同一段脚本加上 subset:true，② 必须立刻变红（它产出的 PDF 打开是方框）", async () => {
    const result = await postRun(container, cjkScript(true));
    expect(result.exitCode, `stderr:\n${result.stderr}`).toBe(0);

    const bytes = Buffer.from(
      result.files.find((f) => f.name === "report.pdf")!.contentBase64,
      "base64",
    );
    const inspection = await inspectPdf(bytes);
    const usable = await inspection.usableGlyphs(drawnCodes(result.stdout));

    // 子集化产出的字体要么整份解析不了，要么用到的字形取不到/没有轮廓——两者都算红。
    const caught = usable.unreadableFont !== null || usable.brokenCodes.length > 0;
    expect(
      caught,
      "subset:true 竟然产出了可用的内嵌字体 —— 若 pdf-lib 已修好子集器，" +
        "可以考虑把子集化搬回运行期并省下几 MB，但要先补一份渲染证据",
    ).toBe(true);
  }, 300_000);

  it("反证：字符集若裁掉生僻字，① 会红（锁住构建期用的是 CJK 全区而不是 GB2312）", async () => {
    // 淼/喆 在 GB2312 之外。这条不重新构建镜像（太贵），而是直接问字体本身——
    // 与 ① 用的是同一个覆盖判据，证明它对"字符集裁小了"这件事确实敏感。
    const probe = await postRun(
      container,
      `
      const fontkit = require('@pdf-lib/fontkit');
      const fs = require('fs');
      const font = fontkit.create(fs.readFileSync(process.env.SKILL_SANDBOX_CJK_FONT));
      const rare = [...'淼喆霁翀'];
      console.log('RARE_MISSING:' + rare.filter((ch) => (font.glyphsForString(ch)[0] || {}).id === 0).join(''));
      `,
    );
    expect(probe.exitCode, probe.stderr).toBe(0);
    expect(/RARE_MISSING:(.*)/.exec(probe.stdout)?.[1]).toBe("");
  }, 300_000);
});

/** 脚本报出来的、页面上真正画下去的字形编号（Identity-H：每 2 字节一个）。 */
function drawnCodes(stdout: string): readonly number[] {
  const hex = /DRAWN_CODES:<([0-9A-Fa-f]+)>/.exec(stdout)?.[1];
  expect(hex, `stdout 里没有 DRAWN_CODES：\n${stdout}`).toBeTruthy();
  const codes: number[] = [];
  for (let i = 0; i < hex!.length; i += 4) codes.push(parseInt(hex!.slice(i, i + 4), 16));
  return codes;
}

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
