/**
 * 中英文支持（2026-09-06 人类反馈：「excel/pdf/word/ppt 都要很好地支持中英文」）。
 *
 * 这四份 SKILL.md 正文会被原样拼进 chat 的 system prompt——模型**只知道这里写了
 * 什么**。所以"沙箱镜像里装了中文字体"这件事，如果没有同时写进 pdf-create 的正文，
 * 对用户就等于不存在：模型会继续按旧正文那句"内置字体不支持中文"去劝退用户。
 * 反过来，正文里那句"必须嵌入预装字体"如果哪天与镜像失配（字体被拿掉、环境变量
 * 改名），产出的就是一页方框。
 *
 * ⇒ 两端各有一个门控，谁都不能单独漂移：
 *   - 镜像/沙箱那端：`apps/skill-sandbox/tests/produces-real-cjk-pdf.test.ts`
 *     （真容器、真嵌字体、真比对字形编号）。
 *   - 正文这端（本文件）：模型被告知的做法与那端**是同一套**（同一个环境变量名、
 *     同一个库名），并且旧的"做不到中文"的劝退话术确实已经被删掉。
 */
import { describe, expect, it } from "vitest";
import {
  DOCX_CREATE_SKILL_MD,
  PDF_CREATE_SKILL_MD,
  PPTX_CREATE_SKILL_MD,
  XLSX_CREATE_SKILL_MD,
} from "../../scripts/office-docs-skill-content";

const ALL = {
  "docx-create": DOCX_CREATE_SKILL_MD,
  "xlsx-create": XLSX_CREATE_SKILL_MD,
  "pptx-create": PPTX_CREATE_SKILL_MD,
  "pdf-create": PDF_CREATE_SKILL_MD,
} as const;

describe("四份 office SKILL.md 都交代了中英文怎么处理", () => {
  for (const [name, content] of Object.entries(ALL)) {
    it(`${name}: 正文里有中文相关的明确指引`, () => {
      expect(content).toMatch(/中文/);
    });

    it(`${name}: 不再出现"做不到中文"这类劝退话术`, () => {
      // 旧正文里 pdf-create 写着"内置字体不支持中文……建议改用 docx 或 xlsx"，
      // 模型照做就会拒绝用户的中文 PDF 请求。这条锁的就是那句话不许回来。
      expect(content).not.toMatch(/不支持中文(?!的)/);
      expect(content).not.toMatch(/只能是\s*英文/);
    });
  }

  it("pdf-create: 教的是嵌入预装字体，且环境变量名与沙箱镜像一致", () => {
    // 名字写错一个字符，模型拿到的就是 undefined —— 与 Dockerfile / execute-script.ts
    // 里的 `SKILL_SANDBOX_CJK_FONT` 必须逐字一致。
    expect(PDF_CREATE_SKILL_MD).toContain("SKILL_SANDBOX_CJK_FONT");
    expect(PDF_CREATE_SKILL_MD).toContain("@pdf-lib/fontkit");
    expect(PDF_CREATE_SKILL_MD).toContain("registerFontkit");
  });

  it("pdf-create: 不许再教 subset:true —— 它产出的 PDF 打开是方框", () => {
    /*
     * 2026-09-06 实测：pdf-lib 的运行期子集器在 TrueType 与 CFF 两条路上都产出损坏的
     * 内嵌字体（三种字体逐个渲染确认）。脚本照常成功、文件照常产出，用户打开看到一页
     * 方框。子集化已挪到镜像构建期用 fontTools 做。
     *
     * 这里断言的是**示例代码里**没有 subset —— 正文可以（也应该）出现禁止它的那句话，
     * 所以不能简单地 grep "subset: true"。
     */
    const samples = PDF_CREATE_SKILL_MD.match(/embedFont\([^)]*\)[^\n]*/g) ?? [];
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample, `示例里出现了 subset：${sample}`).not.toMatch(/subset/);
    }
    expect(PDF_CREATE_SKILL_MD).toContain("绝对不要写");
    // 纯英文文档不该背 4.5MB 的嵌入字体——这条建议必须在，否则每份英文 PDF 都变大。
    expect(PDF_CREATE_SKILL_MD).toContain("StandardFonts.Helvetica");
  });

  it("三份 OOXML skill 不去教嵌字体（它们不需要，教了反而会误导）", () => {
    for (const content of [DOCX_CREATE_SKILL_MD, XLSX_CREATE_SKILL_MD, PPTX_CREATE_SKILL_MD]) {
      expect(content).not.toContain("SKILL_SANDBOX_CJK_FONT");
      expect(content).not.toContain("fontkit");
    }
  });
});
