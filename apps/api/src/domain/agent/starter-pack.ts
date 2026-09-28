import { createHash } from "node:crypto";
import type { z } from "zod";
import { wave2Runtime } from "@repo/contracts";

export type AgentStarterPack = z.infer<typeof wave2Runtime.AgentStarterPack>;
/** AG03 · 官方角色包 —— 条目多出 `roleRef/roleLabel/role`（`OfficialAgentStarterPackEntry`）。 */
export type OfficialAgentStarterPack = z.infer<typeof wave2Runtime.OfficialAgentStarterPack>;

/** AG02 / UC-2 E1：toolPolicy 非能力分类时附 stableName + 字段路径（形状见 contracts `AgentRoleImportFailureDetail`）。 */
export interface StarterToolPolicyViolation {
  readonly stableName: string;
  readonly path: string;
}

export class InvalidAgentStarterPackError extends Error {
  constructor(readonly toolPolicyViolation: StarterToolPolicyViolation | null = null) { super("agent starter pack is invalid"); }
}

function toolPolicyViolation(raw: unknown, issues: readonly z.ZodIssue[]): StarterToolPolicyViolation | null {
  for (const issue of issues) {
    const [root, index, field] = issue.path;
    if (root !== "agents" || typeof index !== "number" || field !== "toolPolicy") continue;
    const agents = (raw as { agents?: unknown }).agents;
    const entry = Array.isArray(agents) ? agents[index] as { stableName?: unknown } | undefined : undefined;
    const stableName = typeof entry?.stableName === "string" ? entry.stableName : "";
    const path = issue.path.map((part, i) => typeof part === "number" ? `[${part}]` : `${i === 0 ? "" : "."}${String(part)}`).join("");
    return { stableName, path };
  }
  return null;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export function verifyAgentStarterPack(raw: unknown, expected: {
  readonly packId: string;
  readonly packVersion: string;
}): AgentStarterPack {
  const parsed = wave2Runtime.AgentStarterPack.safeParse(raw);
  if (!parsed.success) throw new InvalidAgentStarterPackError(toolPolicyViolation(raw, parsed.error.issues));
  const pack = parsed.data;
  if (pack.packId !== expected.packId || pack.packVersion !== expected.packVersion) {
    throw new InvalidAgentStarterPackError();
  }
  const unsigned = {
    schemaVersion: pack.schemaVersion,
    packId: pack.packId,
    packVersion: pack.packVersion,
    agents: pack.agents,
  };
  if (sha256(JSON.stringify(unsigned)) !== pack.packDigest) throw new InvalidAgentStarterPackError();
  const stableNames = new Set<string>();
  const names = new Set<string>();
  for (const agent of pack.agents) {
    const folded = agent.name.toLocaleLowerCase();
    if (stableNames.has(agent.stableName) || names.has(folded)) throw new InvalidAgentStarterPackError();
    stableNames.add(agent.stableName);
    names.add(folded);
    if (sha256(agent.instructions) !== agent.instructionDigest) throw new InvalidAgentStarterPackError();
    const skills = new Set(agent.skillVersions.map((skill) => skill.versionId));
    if (skills.size !== agent.skillVersions.length) throw new InvalidAgentStarterPackError();
  }
  return pack;
}

export function agentImportPayloadDigest(input: { readonly packId: string; readonly packVersion: string }): string {
  return sha256(JSON.stringify({ packId: input.packId, packVersion: input.packVersion }));
}

/**
 * AG03 / UC-3：官方角色包在签名/摘要/重复名字校验上与普通 starter-pack 完全同构（沿用同一套
 * 判定，见 domain.md I-7 前半）——本函数只是 `verifyAgentStarterPack` 的姊妹版，读取
 * `OfficialAgentStarterPack` 而不是 `AgentStarterPack`（条目多出 roleRef/roleLabel/role，但
 * 摘要/重名/instructionDigest/skillVersions 去重的判定逻辑逐字相同）。
 */
export class InvalidOfficialAgentStarterPackError extends Error {
  constructor(readonly toolPolicyViolation: StarterToolPolicyViolation | null = null) { super("official agent starter pack is invalid"); }
}

/** UC-3 端点分流：entries 带 `roleRef` 即按官方角色包处理（不判定其余字段是否合法——那是校验的事）。 */
export function isOfficialAgentStarterPackShape(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const agents = (raw as { agents?: unknown }).agents;
  if (!Array.isArray(agents) || agents.length === 0) return false;
  return agents.every((agent) => typeof agent === "object" && agent !== null && "roleRef" in (agent as object));
}

export function verifyOfficialAgentStarterPack(raw: unknown, expected: {
  readonly packId: string;
  readonly packVersion: string;
}): OfficialAgentStarterPack {
  const parsed = wave2Runtime.OfficialAgentStarterPack.safeParse(raw);
  if (!parsed.success) throw new InvalidOfficialAgentStarterPackError(toolPolicyViolation(raw, parsed.error.issues));
  const pack = parsed.data;
  if (pack.packId !== expected.packId || pack.packVersion !== expected.packVersion) {
    throw new InvalidOfficialAgentStarterPackError();
  }
  const unsigned = {
    schemaVersion: pack.schemaVersion,
    packId: pack.packId,
    packVersion: pack.packVersion,
    agents: pack.agents,
  };
  if (sha256(JSON.stringify(unsigned)) !== pack.packDigest) throw new InvalidOfficialAgentStarterPackError();
  const stableNames = new Set<string>();
  const names = new Set<string>();
  const roleRefs = new Set<string>();
  for (const agent of pack.agents) {
    const folded = agent.name.toLocaleLowerCase();
    if (stableNames.has(agent.stableName) || names.has(folded) || roleRefs.has(agent.roleRef)) {
      throw new InvalidOfficialAgentStarterPackError();
    }
    stableNames.add(agent.stableName);
    names.add(folded);
    roleRefs.add(agent.roleRef);
    if (sha256(agent.instructions) !== agent.instructionDigest) throw new InvalidOfficialAgentStarterPackError();
    const skills = new Set(agent.skillVersions.map((skill) => skill.versionId));
    if (skills.size !== agent.skillVersions.length) throw new InvalidOfficialAgentStarterPackError();
  }
  return pack;
}
