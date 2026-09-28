import { createHash } from "node:crypto";
import type { z } from "zod";
import { wave2Runtime } from "@repo/contracts";

export type AgentStarterPack = z.infer<typeof wave2Runtime.AgentStarterPack>;

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
