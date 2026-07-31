/**
 * F141 -- `assetFileBadgeFromPath` (`uc-23-3` R3 步骤 3 / R7 规则 4 / R12-3).
 *
 * Pure function, no Postgres -- safe to run in full locally (issue #74).
 *
 * ⚠ The one line this bundle exists to prove: **an unknown extension does not throw, and
 *   does not fall back to anything but `MD`.** A `.txt`, a `.canvas`, an extension-less name,
 *   and a directory-looking path with a trailing dot all have to land on the SAME value --
 *   an implementation that special-cases one of them (e.g. returns a distinct "unknown"
 *   marker for `.txt` but `MD` for everything else) would pass a test that only tries `.txt`.
 */
import { describe, expect, it } from "vitest";
import { assetFileBadgeFromPath, AssetFileBadge } from "@repo/contracts/asset-governance";

describe("assetFileBadgeFromPath", () => {
  it("R7 规则 4 逐字：已知扩展名映射到各自徽标", () => {
    expect(assetFileBadgeFromPath("scripts/validate.py")).toBe("PY");
    expect(assetFileBadgeFromPath("tools/tools.json")).toBe("JSON");
    expect(assetFileBadgeFromPath("evals/regression.jsonl")).toBe("JSONL");
    expect(assetFileBadgeFromPath("config.yaml")).toBe("YAML");
    expect(assetFileBadgeFromPath("config.yml")).toBe("YAML");
    expect(assetFileBadgeFromPath("script.sh")).toBe("SH");
    expect(assetFileBadgeFromPath("data.csv")).toBe("CSV");
    expect(assetFileBadgeFromPath("index.js")).toBe("JS");
  });

  it("R12-3：未知扩展名（.txt）不报错，落到 MD", () => {
    expect(() => assetFileBadgeFromPath("notes/scratch.txt")).not.toThrow();
    expect(assetFileBadgeFromPath("notes/scratch.txt")).toBe("MD");
  });

  it("markdown / frontmatter 根文件本身也是 MD（不是「未知」的特例，是同一条规则）", () => {
    expect(assetFileBadgeFromPath("SKILL.md")).toBe("MD");
    expect(assetFileBadgeFromPath("AGENT.md")).toBe("MD");
  });

  it("反证：任意从没见过的扩展名都不报错、都落 MD（不是只对 .txt 特殊处理）", () => {
    for (const ext of ["exe", "bin", "rs", "go", "unknownext123"]) {
      expect(() => assetFileBadgeFromPath(`file.${ext}`)).not.toThrow();
      expect(assetFileBadgeFromPath(`file.${ext}`)).toBe("MD");
    }
  });

  it("边界：无扩展名 / 以 . 结尾 / 隐藏文件（以 . 开头）均落 MD，不报错", () => {
    expect(assetFileBadgeFromPath("README")).toBe("MD");
    expect(assetFileBadgeFromPath("weird.")).toBe("MD");
    expect(assetFileBadgeFromPath(".gitignore")).toBe("MD");
  });

  it("大小写不敏感：.PY / .Json 等价于小写", () => {
    expect(assetFileBadgeFromPath("a.PY")).toBe("PY");
    expect(assetFileBadgeFromPath("a.Json")).toBe("JSON");
  });

  it("返回值恒落在契约的封闭枚举内（不会产出枚举之外的字符串）", () => {
    const samples = ["a.py", "a.json", "a.jsonl", "a.yaml", "a.yml", "a.js", "a.sh", "a.csv", "a.txt", "a"];
    for (const s of samples) {
      expect(AssetFileBadge.safeParse(assetFileBadgeFromPath(s)).success).toBe(true);
    }
  });
});
