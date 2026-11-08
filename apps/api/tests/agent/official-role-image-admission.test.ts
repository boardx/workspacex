import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it, expect } from "vitest";
import { REPO_SKILL_STARTER_PACK_ROOT } from "../../src/infrastructure/skill/file-skill-starter-pack-source";
import { resolveWorkflowDefinitionsRoot } from "../../src/infrastructure/agent/file-workflow-definition-store";
import { buildOfficialAgentRolePack } from "../../src/domain/agent/official-role-packs";
const script = fileURLToPath(
  new URL("../../scripts/verify-official-role-packs.ts", import.meta.url),
);
function verify(root: string) {
  return spawnSync(process.execPath, ["--import", "tsx", script], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: "production",
      SKILL_STARTER_PACK_ROOT: REPO_SKILL_STARTER_PACK_ROOT,
      WORKFLOW_DEFINITIONS_ROOT: root,
    },
    encoding: "utf8",
    timeout: 30000,
  });
}
it("image admission fails closed when canonical workflow assets are absent", () => {
  const root = mkdtempSync(join(tmpdir(), "official-workflow-admission-"));
  try {
    const result = verify(join(root, "missing"));
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("OFFICIAL_ROLE_PACKS_INVALID");
    expect(result.stdout).not.toContain("ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 35000);
it("image admission reads every workflow referenced by the actual shipped role pack", () => {
  const result = verify(resolveWorkflowDefinitionsRoot({}));
  expect(result.status, result.stderr).toBe(0);
  const required = new Set(
    buildOfficialAgentRolePack().agents.flatMap((role) => [
      ...role.role.workflowAllowlist,
    ]),
  );
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: true,
    roles: 7,
    workflows: required.size,
  });
}, 35000);
