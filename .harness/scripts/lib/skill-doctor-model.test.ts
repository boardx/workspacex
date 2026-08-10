import { describe, it, expect } from "vitest";
import { extractRepoPathCandidates, checkSkillFiles } from "./skill-doctor-model";

describe("extractRepoPathCandidates", () => {
  it("提取以已知前缀开头的反引号路径", () => {
    const content = "见 `apps/web/app/chat` 和 `.harness/instructions/coding-standards.md`。";
    expect(extractRepoPathCandidates(content)).toEqual(
      expect.arrayContaining(["apps/web/app/chat", ".harness/instructions/coding-standards.md"]),
    );
  });

  it("展开花括号列表成多条候选路径", () => {
    const content = "`apps/api/src/application/{agent,agent-run,skill}`";
    const result = extractRepoPathCandidates(content);
    expect(result).toEqual(
      expect.arrayContaining([
        "apps/api/src/application/agent",
        "apps/api/src/application/agent-run",
        "apps/api/src/application/skill",
      ]),
    );
    expect(result).toHaveLength(3);
  });

  it("展开两组花括号（笛卡尔积）", () => {
    const content = "`apps/api/src/{infrastructure,domain}/{canvas,artifact}`";
    const result = extractRepoPathCandidates(content);
    expect(result.sort()).toEqual(
      [
        "apps/api/src/infrastructure/canvas",
        "apps/api/src/infrastructure/artifact",
        "apps/api/src/domain/canvas",
        "apps/api/src/domain/artifact",
      ].sort(),
    );
  });

  it("跳过模板占位符路径（含 <phase> 这类变量）", () => {
    const content = "`phases/<phase>/requirements/` 和 `phases/<phase>/contracts/<束>/ui.md`";
    expect(extractRepoPathCandidates(content)).toEqual([]);
  });

  it("跳过省略号简写路径（apps/web/.../rooms/page.tsx）", () => {
    const content = "如「会改 `apps/web/.../rooms/page.tsx`」";
    expect(extractRepoPathCandidates(content)).toEqual([]);
  });

  it("同一行带 skill-doctor:ignore 标记时，整行路径都跳过", () => {
    const content = "// 示例（本仓不存在）：`packages/agent-core`、`apps/orchestrator` <!-- skill-doctor:ignore -->";
    expect(extractRepoPathCandidates(content)).toEqual([]);
  });

  it("跳过命令行内容（含空格且非花括号展开）", () => {
    const content = "跑 `pnpm harness verify --sprint 01/01`";
    expect(extractRepoPathCandidates(content)).toEqual([]);
  });

  it("跳过纯通配符路径（如 apps/*，不是具体路径）", () => {
    const content = "代码平面：`apps/*`、`packages/*`";
    expect(extractRepoPathCandidates(content)).toEqual([]);
  });

  it("跳过不以已知前缀开头的反引号内容（变量名/类名）", () => {
    const content = "用 `Tool<Input, Output>` 接口，调用 `createSession()`";
    expect(extractRepoPathCandidates(content)).toEqual([]);
  });

  it("去重", () => {
    const content = "`apps/web/app/chat` ... 后面又提一次 `apps/web/app/chat`";
    expect(extractRepoPathCandidates(content)).toEqual(["apps/web/app/chat"]);
  });
});

describe("checkSkillFiles", () => {
  it("全部路径存在时 ok=true，findings 为空", () => {
    const files = [
      { skillName: "mod-chat", filePath: ".agents/skills/mod-chat/SKILL.md", content: "见 `apps/web/app/chat`。" },
    ];
    const result = checkSkillFiles(files, () => true);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.totalSkills).toBe(1);
    expect(result.totalReferencedPaths).toBe(1);
  });

  it("路径不存在时 ok=false，记录 skillName/filePath/referencedPath", () => {
    const files = [
      {
        skillName: "mod-chat",
        filePath: ".agents/skills/mod-chat/SKILL.md",
        content: "见 `apps/web/app/does-not-exist`。",
      },
    ];
    const result = checkSkillFiles(files, (p) => p !== "apps/web/app/does-not-exist");
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      {
        skillName: "mod-chat",
        filePath: ".agents/skills/mod-chat/SKILL.md",
        referencedPath: "apps/web/app/does-not-exist",
      },
    ]);
  });

  it("跨多个 skill 文件汇总", () => {
    const files = [
      { skillName: "a", filePath: "a/SKILL.md", content: "`apps/ok`" },
      { skillName: "b", filePath: "b/SKILL.md", content: "`apps/bad`" },
    ];
    const result = checkSkillFiles(files, (p) => p === "apps/ok");
    expect(result.totalSkills).toBe(2);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]?.skillName).toBe("b");
  });
});
