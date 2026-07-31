/**
 * `discoverMcpTools` -- tool discovery / re-discovery (UC-21.1, F52).
 *
 * ## The four things this use case must not do
 *
 * 1. **Must not let the gateway pick the namespace.** Full names are built here, by the
 *    contract's single constructor. A server reporting its tool as `graph.search` is rejected
 *    rather than allowed to collide with the reserved namespace.
 * 2. **Must not put newly found tools into anybody's whitelist** (I-21). Discovery reports
 *    `added`; it does not act on it. New tools land on `未开放`
 *    (`NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE`) -- "权限静默扩大" is what happens when a
 *    re-discovery quietly grows the callable set.
 * 3. **Must not hide a signature change.** A tool whose signature moved is reported in
 *    `signatureChanged`; flipping the referring whitelist entries to `签名已变更需重新确认`
 *    is F55's (the whitelist is its aggregate). Reporting it is what makes I-22 implementable.
 * 4. **Must not let a side-effect change widen a tool's reach.** 🔴 F130 ⑶: if re-discovery
 *    changes `sideEffect`, `checkToolScopeCap` runs again ON THE SPOT and the scope is
 *    tightened, into `tightenedByCapRecheck`. Validating only in `setToolAuthScope` leaves the
 *    "walk in from the read-only side" bypass: a tool set to `全体成员` while it was `只读`
 *    keeps that scope after it starts writing.
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  MAX_SCOPE_RANK_FOR_SIDE_EFFECT,
  McpTool,
  NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE,
  TOOL_AUTH_SCOPE_RANK,
  ToolAuthScope,
  checkToolScopeCap,
  mcpToolFullName,
} from "@repo/contracts/agent-runtime";
import type { DiscoveredTool, McpGateway, McpToolStore } from "./ports";

type Tool = z.infer<typeof McpTool>;
type AuthScope = (typeof ToolAuthScope.options)[number];
type SideEffect = Tool["sideEffect"];

export interface DiscoverMcpToolsDeps {
  readonly gateway: McpGateway;
  readonly store: McpToolStore;
}

export interface DiscoverMcpToolsInput {
  readonly serverId: string;
  readonly endpoint: string;
}

export interface CapRetighten {
  readonly toolFullName: string;
  readonly fromAuthScope: AuthScope;
  readonly toAuthScope: AuthScope;
  readonly newSideEffect: SideEffect;
}

export interface DiscoverMcpToolsResult {
  readonly tools: readonly Tool[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly signatureChanged: readonly string[];
  readonly tightenedByCapRecheck: readonly CapRetighten[];
}

/**
 * `mcp-crm` -> `crm`. The prefix belongs to the contract; this only strips the id's own
 * convention so the namespace does not read `mcp:mcp-crm.x`.
 */
export function serverSlugOf(serverId: string): string {
  return serverId.replace(/^mcp-/, "");
}

/**
 * Fingerprint over the signature and the side effect.
 *
 * ⚠ It covers `sideEffect` too, not just the signature: a tool that keeps its parameters but
 * starts writing has changed in the way that matters most here, and a fingerprint blind to
 * that would report "unchanged" for the single case F130 ⑶ exists to catch.
 */
export function fingerprint(signature: string, sideEffect: SideEffect): string {
  return createHash("sha256").update(`${signature}|${sideEffect}`).digest("hex").slice(0, 16);
}

/** The widest scope still allowed for a side effect -- used to clamp, not merely to reject. */
export function clampScopeToSideEffect(scope: AuthScope, sideEffect: SideEffect): AuthScope {
  if (checkToolScopeCap({ sideEffect, authScope: scope }).ok) return scope;
  const cap = MAX_SCOPE_RANK_FOR_SIDE_EFFECT[sideEffect];
  // The widest declared scope whose rank is within the cap. Derived from the contract's rank
  // table rather than hand-picked, so adding a scope cannot silently miss this branch.
  const within = ToolAuthScope.options.filter((s) => TOOL_AUTH_SCOPE_RANK[s] <= cap);
  return within.reduce((best, s) =>
    TOOL_AUTH_SCOPE_RANK[s] > TOOL_AUTH_SCOPE_RANK[best] ? s : best,
  );
}

/**
 * Gateway record -> contract record. Throws if the resulting full name is illegal.
 *
 * `previousScope` carries a known tool's existing scope through re-discovery; omitted (a new
 * tool) it is `未开放`.
 */
export function toContractTool(
  serverId: string,
  d: DiscoveredTool,
  previousScope: AuthScope = NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE,
): Tool {
  return McpTool.parse({
    fullName: mcpToolFullName(serverSlugOf(serverId), d.name),
    serverId,
    signature: d.signature,
    schemaFingerprint: fingerprint(d.signature, d.sideEffect),
    sideEffect: d.sideEffect,
    authScope: clampScopeToSideEffect(previousScope, d.sideEffect),
  });
}

export async function discoverMcpTools(
  deps: DiscoverMcpToolsDeps,
  input: DiscoverMcpToolsInput,
): Promise<DiscoverMcpToolsResult> {
  // ⚠ The gateway call comes first and is NOT caught: an unreachable server must fail the
  // whole operation (E1 -- no half-written record), not return a partial set.
  const reported = await deps.gateway.listTools(input.serverId, input.endpoint);
  const previous = await deps.store.current(input.serverId);
  const before = new Map(previous.map((t) => [t.fullName, t]));

  const tightenedByCapRecheck: CapRetighten[] = [];
  const tools = reported.map((d) => {
    const fullName = mcpToolFullName(serverSlugOf(input.serverId), d.name);
    const old = before.get(fullName);
    const carried = old?.authScope ?? NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE;
    const tool = toContractTool(input.serverId, d, carried);
    if (old !== undefined && tool.authScope !== carried) {
      tightenedByCapRecheck.push({
        toolFullName: fullName,
        fromAuthScope: carried,
        toAuthScope: tool.authScope,
        newSideEffect: d.sideEffect,
      });
    }
    return tool;
  });

  const after = new Map(tools.map((t) => [t.fullName, t]));
  const added = tools.filter((t) => !before.has(t.fullName)).map((t) => t.fullName);
  const removed = previous.filter((t) => !after.has(t.fullName)).map((t) => t.fullName);
  const signatureChanged = tools
    .filter((t) => {
      const old = before.get(t.fullName);
      return old !== undefined && old.schemaFingerprint !== t.schemaFingerprint;
    })
    .map((t) => t.fullName);

  await deps.store.replace(input.serverId, tools);

  // ⚠ No whitelist is touched here. See the header, point 2.
  return { tools, added, removed, signatureChanged, tightenedByCapRecheck };
}
