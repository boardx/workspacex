// spec-ref.test.ts — 用一次性 fixture phase 目录测真实文件系统行为（本仓 CLI 脚本
// 测试的既有惯例：doctor/verify/claim 等都靠端到端而非 mock fs）。每个 test 各建
// 各清，互不干扰；phase id 用 "zz-spec-ref-test" 避免撞真实 phase。
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PHASES_DIR } from "./paths";
import { hasRequirementsCoverage, resolveSpecRef } from "./spec-ref";

const PHASE_ID = "zz-spec-ref-test";
const PHASE_DIR = join(PHASES_DIR, `phase-${PHASE_ID}-fixture`);
const REQ_DIR = join(PHASE_DIR, "requirements");
const CONTRACTS_DIR = join(PHASE_DIR, "contracts");

function writeReq(file: string, body: string): void {
  writeFileSync(join(REQ_DIR, file), body, "utf8");
}

/** 造一个假契约束：phases/<fixture>/contracts/<bundle>/design-signoff.md */
function writeBundleSignoff(bundle: string, frontmatter: string): void {
  const dir = join(CONTRACTS_DIR, bundle);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "design-signoff.md"),
    `---\n${frontmatter}\n---\n\n# 契约束 \`${bundle}\` 设计签核\n`,
    "utf8",
  );
}

beforeEach(() => {
  mkdirSync(REQ_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(PHASE_DIR)) rmSync(PHASE_DIR, { recursive: true, force: true });
});

describe("resolveSpecRef", () => {
  it("缺 spec_ref → 不通过，给出提示", () => {
    const r = resolveSpecRef(PHASE_ID, undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/缺少 spec_ref/);
  });

  it("空字符串同缺失处理", () => {
    expect(resolveSpecRef(PHASE_ID, "   ").ok).toBe(false);
  });

  it("格式不对（没有 #R<n>）→ 不通过", () => {
    const r = resolveSpecRef(PHASE_ID, "auth.md");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/格式不对/);
  });

  it("引用的文件不存在 → 不通过", () => {
    const r = resolveSpecRef(PHASE_ID, "ghost.md#R1");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/文件不存在/);
  });

  it("文件存在但没有那个章节 → 不通过", () => {
    writeReq("auth.md", "## R1 背景\n内容");
    const r = resolveSpecRef(PHASE_ID, "auth.md#R3");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/找不到/);
  });

  it("文件 + 章节都存在 → 通过", () => {
    writeReq("auth.md", "## R1 背景\n内容\n\n## R3 验收线索\n更多内容");
    expect(resolveSpecRef(PHASE_ID, "auth.md#R3").ok).toBe(true);
  });

  it("章节匹配是前缀匹配（标题可以带后缀文字）", () => {
    writeReq("auth.md", "## R3 验收线索（成功与失败都要写）\n内容");
    expect(resolveSpecRef(PHASE_ID, "auth.md#R3").ok).toBe(true);
  });

  it("R3 不应误匹配 R30（词边界）", () => {
    writeReq("auth.md", "## R30 无关章节\n内容");
    expect(resolveSpecRef(PHASE_ID, "auth.md#R3").ok).toBe(false);
  });
});

// ── 契约束锚点 `contracts/<bundle>#confirmed`（2026-08-26，人类裁决方案 3）──
// 正反证据：已签核的束能通过；未签核（pending）的束必须红；格式错误
// （束目录不存在 / design-signoff.md 缺失）必须红。
describe("resolveSpecRef — contracts/<bundle>#confirmed 锚点", () => {
  it("正向：指向已签核（status: confirmed）的束 → 通过", () => {
    writeBundleSignoff(
      "plan-control-fixture",
      `bundle: plan-control-fixture\nphase: "${PHASE_ID}"\nstatus: confirmed\nconfirmed_by: usamshen\nconfirmed_at: "2026-08-26T00:00:00Z"`,
    );
    const r = resolveSpecRef(PHASE_ID, "contracts/plan-control-fixture#confirmed");
    expect(r.ok).toBe(true);
  });

  it("反向：指向未签核（status: pending）的束 → 不通过", () => {
    writeBundleSignoff(
      "pending-fixture",
      `bundle: pending-fixture\nphase: "${PHASE_ID}"\nstatus: pending`,
    );
    const r = resolveSpecRef(PHASE_ID, "contracts/pending-fixture#confirmed");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/尚未签核/);
  });

  it("反向：束目录不存在 → 不通过", () => {
    const r = resolveSpecRef(PHASE_ID, "contracts/ghost-bundle#confirmed");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/design-signoff\.md 不存在/);
  });

  it("反向：束目录存在但没有 design-signoff.md → 不通过", () => {
    mkdirSync(join(CONTRACTS_DIR, "no-signoff-fixture"), { recursive: true });
    const r = resolveSpecRef(PHASE_ID, "contracts/no-signoff-fixture#confirmed");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/design-signoff\.md 不存在/);
  });

  it("格式：结尾不是 #confirmed（如 #pending）→ 落回 requirements 格式校验并判失败", () => {
    const r = resolveSpecRef(PHASE_ID, "contracts/plan-control-fixture#pending");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/格式不对/);
  });

  it("不会与 requirements 锚点互相误判：普通 .md#R<n> 仍走原逻辑", () => {
    writeReq("auth.md", "## R3 验收线索\n内容");
    expect(resolveSpecRef(PHASE_ID, "auth.md#R3").ok).toBe(true);
  });
});

describe("hasRequirementsCoverage", () => {
  it("requirements/ 目录不存在 → 不通过", () => {
    rmSync(PHASE_DIR, { recursive: true, force: true });
    const r = hasRequirementsCoverage(PHASE_ID);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/找不到/);
  });

  it("目录存在但只有 README.md → 不通过", () => {
    writeReq("README.md", "说明文档，不算需求");
    const r = hasRequirementsCoverage(PHASE_ID);
    expect(r.ok).toBe(false);
  });

  it("只有未填写的裸模板（含占位符）→ 不通过", () => {
    writeReq("overview.md", "# 原始需求 — {{PHASE_NAME}}（Phase {{PHASE_ID}}）\n\n## R1 背景\n<填写>");
    const r = hasRequirementsCoverage(PHASE_ID);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/裸模板/);
  });

  it("至少一份文档已填写真实内容 → 通过", () => {
    writeReq("overview.md", "# 原始需求 — {{PHASE_NAME}}\n\n## R1 背景\n<填写>"); // 仍是模板
    writeReq("auth.md", "## R1 背景\n登录需要支持 SSO，因为企业客户要求统一身份。");
    expect(hasRequirementsCoverage(PHASE_ID).ok).toBe(true);
  });
});
