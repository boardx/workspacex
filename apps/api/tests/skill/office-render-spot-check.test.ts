/**
 * 2026-09-27 人类反馈：PPT「收尾很久」，要求渲染验收改成抽检，最多 3 张截图。
 *
 * 实测：13 页 PPT，模型按 skill 指引「Inspect every actual page PNG」逐张看图——每张都是一次
 * 带图的模型往返，界面停在「正在收尾」好几分钟。改成：渲染器在 manifest 里给出 `inspect`
 * （封面 + 中间 + 末页，≤3 张），skill 指引只让模型看这几张，发现缺陷才再看别的页。
 *
 * 函数取自**真实**脚本源码（AST 抽出执行），不是测试里重写一份。
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { officeSkillPackage } from "../../scripts/office-skill-packages";
import { OFFICIAL_SKILLS } from "../../src/infrastructure/skill/ensure-platform-skill-catalog";

const RENDERER = fileURLToPath(new URL("../../scripts/office-package-resources/render-office.py", import.meta.url));

function sample(pageCount: number): string[] {
  const code = [
    "import ast, json, sys",
    "src = open(sys.argv[1]).read()",
    "fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == 'inspection_sample')",
    "ns = {}",
    "exec(compile(ast.Module(body=[fn], type_ignores=[]), 'render-office.py', 'exec'), ns)",
    "pages = ['page-%02d.png' % (i + 1) for i in range(int(sys.argv[2]))]",
    "print(json.dumps(ns['inspection_sample'](pages)))",
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-c", code, RENDERER, String(pageCount)], { encoding: "utf8" })) as string[];
}

describe("Office 渲染验收：抽检，最多 3 张", () => {
  it("13 页只抽封面、中间、末页", () => {
    expect(sample(13)).toEqual(["page-01.png", "page-07.png", "page-13.png"]);
  });

  it("任何页数都不超过 3 张，且一定含首末页", () => {
    for (const n of [4, 5, 12, 40, 200]) {
      const picked = sample(n);
      expect(picked.length).toBe(3);
      expect(picked[0]).toBe("page-01.png");
      expect(picked.at(-1)).toBe(`page-${String(n).padStart(2, "0")}.png`);
    }
  });

  it("配对：3 页及以下全看，不因抽检漏页", () => {
    expect(sample(1)).toEqual(["page-01.png"]);
    expect(sample(3)).toEqual(["page-01.png", "page-02.png", "page-03.png"]);
  });

  it("抽样函数定义在顶层执行代码之前（脚本是顶层直跑的，定义在后会 NameError）", () => {
    const src = execFileSync("cat", [RENDERER], { encoding: "utf8" });
    expect(src.indexOf("def inspection_sample(")).toBeGreaterThan(-1);
    expect(src.indexOf("def inspection_sample(")).toBeLessThan(src.indexOf("inspection_sample(pages)"));
  });

  it("发布给模型的 skill 指引说抽检、不再要求逐页看", () => {
    for (const spec of OFFICIAL_SKILLS) {
      const files = officeSkillPackage(spec).package.files.map((f) => Buffer.from(f.contentBase64, "base64").toString());
      const text = files.join("\n");
      expect(text).not.toMatch(/Inspect every actual page PNG|examine\s+each page\/slide/);
      expect(text).toContain("at most 3");
      expect(text).toContain("inspect list");
    }
  });
});
