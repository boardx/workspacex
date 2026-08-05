import { createHash } from "node:crypto";
import type { z } from "zod";
import { wave2Runtime } from "@repo/contracts";

export type AgentStarterPack = z.infer<typeof wave2Runtime.AgentStarterPack>;

export class InvalidAgentStarterPackError extends Error {
  constructor() { super("agent starter pack is invalid"); }
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export function verifyAgentStarterPack(raw: unknown, expected: {
  readonly packId: string;
  readonly packVersion: string;
}): AgentStarterPack {
  const parsed = wave2Runtime.AgentStarterPack.safeParse(raw);
  if (!parsed.success) throw new InvalidAgentStarterPackError();
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
