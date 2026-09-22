/**
 * `parseSkillFrontmatter` 的反证套件（issue #3154）。
 *
 * 这是标准 skill 的 stable_name / version / capability_id 的**唯一**读取入口：
 * `skills/<pack>/scripts/build.ts` 把它读出来的值直接写进发货产物，
 * `.harness/scripts/lint-skill-metadata-source.mjs` 用同一段代码判 SKILL.md 合不合规。
 * 所以它读错一个字段，发货产物就错一个字段——这里逐条钉住它的边界。
 *
 * 放在 `.harness/` 而不是 `apps/api/tests/`：它是纯函数、不碰 DB，而 `@repo/api` 的默认
 * vitest 套件带 `tests/support/db-global-setup.ts`，跑一条断言也要先起 Postgres 容器。
 * 这里和依赖同一个解析器的 `lint-skill-metadata-source` 门控同槽，跟着那条毫秒级、
 * 无 DB 的 harness 车道一起跑（`postinvest-rating-purity.test.ts` 等同样 import apps/api/src）。
 */
import { describe, expect, it } from "vitest";
import { parseSkillFrontmatter, SkillFrontmatterError } from "../../apps/api/src/domain/skill/skill-frontmatter";

const flat = [
  "---",
  "name: audio-transcription",
  "description: Transcribe authorized audio.",
  "capability_id: WX-S016",
  "version: 1.1.1",
  "---",
  "",
  "# Audio transcription",
].join("\n");

const nested = [
  "---",
  "name: skill-authoring",
  "description: 技能草稿。",
  "metadata:",
  "  capability_id: WX-S015",
  "  version: 1.0.0",
  "---",
  "",
  "# 技能草稿",
].join("\n");

describe("两种真实写法都读得出来", () => {
  it("顶层写法", () => {
    expect(parseSkillFrontmatter(flat, "audio-transcription")).toEqual({
      stableName: "audio-transcription",
      semanticVersion: "1.1.1",
      capabilityId: "WX-S016",
      nestedMetadata: false,
    });
  });

  it("metadata: 嵌一层的历史写法——读得出来，并且**标记**出来供只减不增的名单核对", () => {
    expect(parseSkillFrontmatter(nested, "skill-authoring")).toEqual({
      stableName: "skill-authoring",
      semanticVersion: "1.0.0",
      capabilityId: "WX-S015",
      nestedMetadata: true,
    });
  });

  it("带引号的值会脱引号——`version: '1.0.0'` 与 `version: 1.0.0` 是同一个事实", () => {
    expect(parseSkillFrontmatter(flat.replace("version: 1.1.1", "version: \"1.1.1\""), "audio-transcription").semanticVersion).toBe("1.1.1");
  });
});

describe("读不出来就抛，不返回半个结果", () => {
  it("没有 frontmatter ⇒ 抛", () => {
    expect(() => parseSkillFrontmatter("# 只有正文", "a")).toThrow(SkillFrontmatterError);
  });

  it("缺 version / capability_id ⇒ 抛，并逐个点名（迁移前那 7 个 skill 的真实形态）", () => {
    const missing = ["---", "name: meeting-minutes", "description: x", "---", ""].join("\n");
    expect(() => parseSkillFrontmatter(missing, "meeting-minutes")).toThrow(/缺 version \/ capability_id/);
  });

  it("顶层与 metadata: 下各写一遍 ⇒ 抛，哪怕值一样（同一事实两处声明）", () => {
    const both = ["---", "name: a", "version: 1.0.0", "metadata:", "  version: 1.0.0", "  capability_id: WX-S001", "---", ""].join("\n");
    expect(() => parseSkillFrontmatter(both, "a")).toThrow(/同时在顶层和 metadata: 下写了 version/);
  });

  it("frontmatter 的 name 与目录名漂移 ⇒ 抛（按名字找目录会悄悄取错文件）", () => {
    expect(() => parseSkillFrontmatter(flat, "audio-transcribe")).toThrow(/与目录名 "audio-transcribe" 不一致/);
  });

  it("version 不是 x.y.z ⇒ 抛", () => {
    expect(() => parseSkillFrontmatter(flat.replace("version: 1.1.1", "version: latest"), "audio-transcription")).toThrow(/不是 x\.y\.z/);
  });

  it("name 不是合法 stable_name ⇒ 抛", () => {
    expect(() => parseSkillFrontmatter(flat.replace("name: audio-transcription", "name: Audio_Transcription"), undefined)).toThrow(/不是合法 stable_name/);
  });

  it("不传目录名时不做那条比对——别的判定照常生效", () => {
    expect(parseSkillFrontmatter(flat).stableName).toBe("audio-transcription");
  });
});

describe("解析边界", () => {
  it("只吃 frontmatter，不把正文里同名的行当声明", () => {
    const withBody = `${flat}\n\nversion: 9.9.9\ncapability_id: WX-S999\n`;
    expect(parseSkillFrontmatter(withBody, "audio-transcription")).toMatchObject({ semanticVersion: "1.1.1", capabilityId: "WX-S016" });
  });

  it("CRLF 的 SKILL.md 照样读得出来", () => {
    expect(parseSkillFrontmatter(flat.replace(/\n/g, "\r\n"), "audio-transcription").semanticVersion).toBe("1.1.1");
  });

  it("metadata: 块结束后的顶层字段不会被当成嵌套项", () => {
    const after = ["---", "name: a", "metadata:", "  capability_id: WX-S001", "version: 1.2.3", "---", ""].join("\n");
    expect(parseSkillFrontmatter(after, "a")).toMatchObject({ semanticVersion: "1.2.3", capabilityId: "WX-S001", nestedMetadata: true });
  });
});
