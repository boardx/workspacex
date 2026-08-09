import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { generatePersistentClaudeMd, generatePersistentCodexToml, assertSpecialistWorkerSpec } from "./gen-subagents";
import { KIND_TO_LAYER } from "./lib/role-authorization";
import { REPO_ROOT } from "./lib/paths";

const ROLE_IDS = [
  "coord-main",
  "coord-architecture",
  "dev-chat-e2e",
  "dev-ai-runtime",
  "rev-feature",
  "rev-e2e",
] as const;

const BOUNDED_SUBAGENTS = [
  "code-reviewer",
  "codebase-researcher",
  "e2e-verifier",
  "feature-evaluator",
  "quality-auditor",
  "requirement-author",
  "test-runner",
  "ui-prototyper",
] as const;

interface PersistentRoleSpec {
  name: string;
  description: string;
  role: "persistent-project-role";
  kind: string;
  areas: string[];
  reports_to: string | null;
  merge_authority: boolean;
  dispatch_authority: boolean;
  developer_instructions: string;
}

const rolesDir = join(REPO_ROOT, ".harness", "agents", "roles");
const claudeDir = join(REPO_ROOT, ".claude", "agents");
const codexDir = join(REPO_ROOT, ".codex", "agents");

function readRole(roleId: string): { raw: string; spec: PersistentRoleSpec } {
  const raw = readFileSync(join(rolesDir, `${roleId}.yaml`), "utf8");
  return { raw, spec: parse(raw) as PersistentRoleSpec };
}

function generated(roleId: string): { claude: string; codex: string } {
  return {
    claude: readFileSync(join(claudeDir, `${roleId}.md`), "utf8"),
    codex: readFileSync(join(codexDir, `${roleId}.toml`), "utf8"),
  };
}

function forbiddenRuntimeMaterial(text: string): string[] {
  return [
    ...text.matchAll(/agt_[0-9A-HJKMNP-TV-Z]{26}/g),
    ...text.matchAll(/(?:token|private[_ -]?key)\s*[:=]\s*["']?[^\s"']+/gi),
  ].map((match) => match[0]);
}

describe("#441 portable persistent role generator", () => {
  it("defines exactly the six signed stable roles in the dedicated neutral source", () => {
    expect(readdirSync(rolesDir).filter((file) => file.endsWith(".yaml")).sort()).toEqual(
      ROLE_IDS.map((roleId) => `${roleId}.yaml`).sort(),
    );

    for (const roleId of ROLE_IDS) {
      const { spec } = readRole(roleId);
      expect(spec).toMatchObject({
        name: roleId,
        role: "persistent-project-role",
        merge_authority: roleId === "coord-main",
        dispatch_authority: ["coord-main", "coord-architecture"].includes(roleId),
      });
      expect(spec.description.trim()).not.toBe("");
      expect(spec.developer_instructions.trim()).not.toBe("");
      expect(spec.developer_instructions).not.toMatch(/(?:允许|不得)合并 PR|(?:可以|不得)派发/);
      expect(spec.areas.length).toBeGreaterThan(0);
      expect(Object.hasOwn(spec, "model")).toBe(false);
      expect(Object.hasOwn(spec, "directory_agent_id")).toBe(false);
    }
  });

  it("generates current Claude frontmatter and current top-level Codex fields from every role", () => {
    for (const roleId of ROLE_IDS) {
      const { spec } = readRole(roleId);
      const output = generated(roleId);

      expect(output.claude).toMatch(new RegExp(`^---\\nname: ${roleId}\\n`));
      expect(output.claude).toContain(`description: ${spec.description.trim().replace(/\n/g, " ")}`);
      expect(output.claude).toContain(spec.developer_instructions.trim());
      expect(output.claude).not.toMatch(/^model:/m);

      expect(output.codex).toMatch(new RegExp(`^name = "${roleId}"\\n`));
      expect(output.codex).toContain("\ndescription = \"\"\"\n");
      expect(output.codex).toContain("\ndeveloper_instructions = \"\"\"\n");
      expect(output.codex).toContain(spec.developer_instructions.trim());
      expect(output.codex).not.toContain("[agent]");
      expect(output.codex).not.toMatch(/^model\s*=/m);
    }
  });

  it("keeps runtime identity, credentials and model selection out of sources and outputs", () => {
    for (const roleId of ROLE_IDS) {
      const { raw } = readRole(roleId);
      const output = generated(roleId);
      const combined = `${raw}\n${output.claude}\n${output.codex}`;
      expect(forbiddenRuntimeMaterial(combined), roleId).toEqual([]);
      expect(combined).not.toMatch(/^\s*(?:model|claude_model|codex_model|directory_agent_id)\s*:/m);
    }
  });

  it("fails closed on unknown fields and recursive secret or credential material", () => {
    const { spec } = readRole("dev-chat-e2e");
    const aliasedCredential = {
      credentialCache: ".harness/state/.cache/coord-credentials.json",
    };
    const canaries: ReadonlyArray<{ readonly label: string; readonly value: unknown }> = [
      {
        label: "ordinary unknown field",
        value: { ...spec, notes: "fake-review-canary" },
      },
      {
        label: "review secret field",
        value: { ...spec, secret: "fake-review-canary" },
      },
      {
        label: "review credential_cache field",
        value: {
          ...spec,
          credential_cache: ".harness/state/.cache/coord-credentials.json",
        },
      },
      {
        label: "nested credential cache field",
        value: {
          ...spec,
          metadata: {
            credential_cache: ".harness/state/.cache/coord-credentials.json",
          },
        },
      },
      {
        label: "nested camelCase alias reused by two branches",
        value: {
          ...spec,
          metadata: {
            primary: aliasedCredential,
            alias: aliasedCredential,
          },
        },
      },
      {
        label: "YAML anchor alias containing a credential-cache key",
        value: parse(`
name: dev-chat-e2e
description: Review canary only
role: persistent-project-role
kind: worker
areas: [chat, e2e]
reports_to: coord-main
merge_authority: false
dispatch_authority: false
developer_instructions: Safe review canary
metadata: &credential_alias
  credential-cache: .harness/state/.cache/coord-credentials.json
metadata_alias: *credential_alias
`),
      },
      {
        label: "hyphenated token alias",
        value: {
          ...spec,
          metadata: { "api-token": "fake-review-canary" },
        },
      },
      {
        label: "credential cache path inside an allowed string",
        value: {
          ...spec,
          developer_instructions:
            `${spec.developer_instructions}\nRead .harness/state/.cache/coord-credentials.json.`,
        },
      },
      {
        label: "password assignment inside an allowed string",
        value: {
          ...spec,
          developer_instructions: `${spec.developer_instructions}\npassword=fake-review-canary`,
        },
      },
      {
        label: "private key assignment alias inside an allowed string",
        value: {
          ...spec,
          developer_instructions: `${spec.developer_instructions}\nprivate-key=fake-review-canary`,
        },
      },
    ];

    for (const canary of canaries) {
      const invalid = canary.value as PersistentRoleSpec;
      expect(() => generatePersistentClaudeMd(invalid), canary.label).toThrow();
      expect(() => generatePersistentCodexToml(invalid), canary.label).toThrow();
    }
  });

  it("preserves all eight bounded subagents beside the new persistent role surfaces", () => {
    const claudeNames = new Set(readdirSync(claudeDir).filter((file) => file.endsWith(".md")));
    const codexNames = new Set(readdirSync(codexDir).filter((file) => file.endsWith(".toml")));

    for (const name of BOUNDED_SUBAGENTS) {
      expect(claudeNames.has(`${name}.md`), name).toBe(true);
      expect(codexNames.has(`${name}.toml`), name).toBe(true);
      expect(readFileSync(join(codexDir, `${name}.toml`), "utf8")).toContain("[agent]");
    }
  });

  it("matches both tracked surfaces to deterministic pure generation", () => {
    for (const roleId of ROLE_IDS) {
      const { spec } = readRole(roleId);
      const output = generated(roleId);
      expect(generatePersistentClaudeMd(spec), roleId).toBe(output.claude);
      expect(generatePersistentCodexToml(spec), roleId).toBe(output.codex);
      expect(generatePersistentClaudeMd(spec), roleId).toBe(generatePersistentClaudeMd(spec));
      expect(generatePersistentCodexToml(spec), roleId).toBe(generatePersistentCodexToml(spec));
    }
  });

  it("keeps merge and dispatch authority least-privileged in source and generated prompts", () => {
    for (const roleId of ROLE_IDS) {
      const { spec } = readRole(roleId);
      const output = generated(roleId);
      const combinedPrompt = `${spec.developer_instructions}\n${output.claude}\n${output.codex}`;

      if (roleId === "coord-main") expect(combinedPrompt).toContain("唯一允许合并 PR");
      else expect(combinedPrompt).toContain("不得合并 PR");

      if (["coord-main", "coord-architecture"].includes(roleId)) {
        expect(combinedPrompt).toContain("可以派发");
      } else {
        expect(combinedPrompt).toContain("不得派发");
      }
    }
  });

  // H3A-028：generator 必须接 H3A-020 的 KIND_TO_LAYER 表，不能各自校验、互不
  // 感知——这条对全部 6 个真实持久角色文件跑一遍，确认它们的 kind 今天全部能
  // 派生出 layer（生成器和 role-authorization doctor 看到同一个结论）。
  it("H3A-028: every real persistent role kind derives a layer through the same KIND_TO_LAYER table", () => {
    for (const roleId of ROLE_IDS) {
      const { spec } = readRole(roleId);
      expect(spec.kind in KIND_TO_LAYER, `${roleId} kind="${spec.kind}"`).toBe(true);
    }
  });

  // H3A-028 反证：构造一个曾经会静默通过 gen-subagents（只检查 kind 非空
  // 字符串）、但 role-authorization doctor 会判 H3A020-INVALID-ROLE-FIELD FAIL
  // 的角色文件——kind 打错、映射不到任何 layer。修复前这个 spec 能正常生成出
  // Claude/Codex 双格式文件；修复后两个生成函数都必须拒绝。
  it("H3A-028 counterexample: rejects a persistent role whose kind cannot derive a layer", () => {
    const { spec } = readRole("dev-chat-e2e");
    const drifted = { ...spec, kind: "coordinatoor" }; // 打错的 kind，不在 KIND_TO_LAYER 里
    expect(() => generatePersistentClaudeMd(drifted)).toThrow(/无法派生 layer/);
    expect(() => generatePersistentCodexToml(drifted)).toThrow(/无法派生 layer/);
  });

  // H3A-028/H3A-023 反证：扁平 subagent spec 缺 `role` 字段（H3A023-MISSING-
  // ROLE-FIELD，FAIL 严重度）今天在 gen-subagents 里完全没有对应校验——只检查
  // `name`。这条确认接入 checkSpecialistWorkerSpecs 之后，生成前会挡住它，
  // 而不是照常产出一份 role-authorization doctor 会判 FAIL 的 subagent。
  it("H3A-028 counterexample: rejects a flat subagent spec missing the H3A-023 role field", () => {
    expect(() =>
      assertSpecialistWorkerSpec("fake.yaml", {
        sourceFile: "fake.yaml",
        name: "fake-worker",
        role: undefined,
        tools: ["read_files"],
      }),
    ).toThrow(/H3A-023/);
  });

  it("H3A-028: accepts a well-formed flat subagent spec and only warns (not blocks) on missing tools", () => {
    expect(() =>
      assertSpecialistWorkerSpec("fake.yaml", {
        sourceFile: "fake.yaml",
        name: "fake-worker",
        role: "fake-worker",
        tools: ["read_files"],
      }),
    ).not.toThrow();
    expect(() =>
      assertSpecialistWorkerSpec("fake.yaml", {
        sourceFile: "fake.yaml",
        name: "fake-worker",
        role: "fake-worker",
        tools: [],
      }),
    ).not.toThrow();
  });
});
