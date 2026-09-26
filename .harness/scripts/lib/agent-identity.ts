/**
 * agent-identity.ts —— 「一个 agent 身份是否真实存在」的单一事实源（#1142）。
 *
 * ## 为什么是一份而不是三份
 *
 * 这套判据（registry.yaml 的**全部**身份分组 ∪ `.harness/agents/*.yaml` 的便携
 * subagent 规格）原本只长在 `role-scorecard.ts` 里，是私有函数。#1142 要给
 * `feature.owner` 加同一道判据——第二个调用方一出现，就必须先收敛成一份，
 * 否则本仓已经栽过五次的「同一事实声明在两处然后漂移」会第六次发生
 * （AGENTS.md 的硬约束原文）。
 *
 * 两处踩过的坑原样保留在下面的注释里——它们是判据的一部分，不是装饰：
 * 少读一个分组 / 少读一个来源，都会把真实身份误判成「不存在」。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./paths";

export const REGISTRY_PATH = join(REPO_ROOT, ".harness", "agents", "registry.yaml");
export const AGENT_SPEC_DIR = join(REPO_ROOT, ".harness", "agents");

export interface AgentIdentity {
  readonly kind: string;
  readonly reportsTo: string | null;
  readonly active: boolean;
}

interface RegistryAgent { id: string; kind?: string; reports_to?: string; active?: boolean }

/**
 * 读 `registry.yaml` 里**所有**身份分组，不只是 `agents:`。
 *
 * ⚠ 实测踩过：第一版只读 `agents:`，于是 `rev-e2e` / `rev-uiux` 被判成「不在 registry」——
 * 它们其实在 `reviewers:` 分组下。registry 是分组的（agents / reviewers / …），
 * 按单个键名去读等于给自己造了一份「registry 的子集」当事实源。
 * 这里扫描所有「数组且元素带 id」的顶层键，新增分组时不用回来改这里。
 */
export function readRegistryIdentities(): Map<string, AgentIdentity> {
  const out = new Map<string, AgentIdentity>();
  if (!existsSync(REGISTRY_PATH)) return out;
  const doc = parse(readFileSync(REGISTRY_PATH, "utf8")) as Record<string, unknown>;
  for (const value of Object.values(doc)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value as RegistryAgent[]) {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string") continue;
      out.set(entry.id, {
        kind: entry.kind ?? "unknown",
        reportsTo: entry.reports_to ?? null,
        // 缺省视为在编：registry 里绝大多数条目不写 active，写 false 才是明确的停用裁决。
        active: entry.active !== false,
      });
    }
  }
  return out;
}

/**
 * 便携 subagent 规格（`.harness/agents/<name>.yaml`，`registry.yaml` 除外）也是**合法身份来源**。
 *
 * ⚠ 实测踩过第二次同型：第一版只认 `registry.yaml`，于是 `rev-uiux` 被判成
 * 「不在 registry 里」。但 `rev-uiux` 是**便携 subagent 角色**（由该 yaml 生成
 * `.claude/agents/rev-uiux.md`），它**根本不需要** registry 那套 Directory ULID / token
 * ——registry 收的是 coordinator / reviewer 那类需要授权凭据的身份。
 *
 * 实测依据（coord-main 2026-08-12 提的问题，role-scorecard 作者查的结论）：
 * `core-loop-readiness.ts` **零 import、零 registry/yaml 引用**，G3 的
 * `allowed_scorers.includes(scored_by)` 是 JSON 内部的字符串比对，
 * **从不拿 registry.yaml 做鉴权**。所以 CLR 的评分授权与 registry 身份是两套东西，
 * 把它们混成一套正是那一版的错。
 *
 * ⇒ 角色的权威来源是**两者的并集**，不是 registry 一家。
 */
export function readSubagentSpecIdentities(): Map<string, AgentIdentity> {
  const out = new Map<string, AgentIdentity>();
  if (!existsSync(AGENT_SPEC_DIR)) return out;
  for (const f of readdirSync(AGENT_SPEC_DIR)) {
    if (!f.endsWith(".yaml") || f === "registry.yaml") continue;
    try {
      const doc = parse(readFileSync(join(AGENT_SPEC_DIR, f), "utf8")) as { name?: string };
      if (typeof doc?.name === "string") {
        out.set(doc.name, { kind: "subagent", reportsTo: null, active: true });
      }
    } catch { /* 读不了就跳过：宁可少认一个，也不要伪造一个身份 */ }
  }
  return out;
}

/** 并集视图。registry 覆盖同名 subagent 规格（registry 带授权信息，更权威）。 */
export function readKnownAgentIdentities(): Map<string, AgentIdentity> {
  return new Map([...readSubagentSpecIdentities(), ...readRegistryIdentities()]);
}
