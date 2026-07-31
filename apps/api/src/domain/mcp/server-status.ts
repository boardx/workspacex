/**
 * MCP server status -- the three orthogonal fields, and the invariant that keeps them apart
 * (domain I-17 / UC-21.1 V18 / O-20). Innermost layer: imports nothing but the contract's
 * enums, which are values, not an outer layer.
 *
 * ## Why this file exists, given the contract already declares the three fields
 *
 * zod can say `connectionStatus: enum(5)`. It cannot say "and `不可达` must never be recorded
 * as `已隔离`". That second sentence is the whole point of the ruling, and it is about a
 * WRITE, not a shape -- so it has to live somewhere writes go through.
 *
 * The failure mode is concrete and named in the UC: a probe times out; the code handling the
 * timeout has `已隔离` close at hand (it is what a new server gets); it writes that. Every
 * schema stays green. The admin then opens the review record to find out why the tool is
 * unavailable, and the review record says nothing, because the cause was the network.
 */
import {
  McpConnectionStatus,
  McpReviewStatus,
  ToolAuthScope,
} from "@repo/contracts/agent-runtime";

export type AuthScope = (typeof ToolAuthScope.options)[number];
export type ReviewStatus = (typeof McpReviewStatus.options)[number];
export type ConnectionStatus = (typeof McpConnectionStatus.options)[number];

/**
 * What a probe observed. Deliberately NOT the same type as `ConnectionStatus`:
 * a probe cannot observe `已隔离` -- isolation is a policy outcome and the probe knows nothing
 * about policy. Making them one type is exactly the merge the ruling forbids, and it would be
 * invisible, because both are "a string saying how it went".
 */
export type ProbeOutcome = "reachable" | "rate-limited" | "timeout" | "auth-rejected";

/**
 * The ONLY mapping from an observation to a recorded connection status.
 *
 * ⚠ `timeout` maps to `不可达`, never to `已隔离`. There is no branch here that can produce
 * `已隔离`, and that absence IS the invariant: isolation comes from the policy path
 * (`isolatedByPolicy`), never from a probe.
 */
export function connectionStatusFromProbe(outcome: ProbeOutcome): ConnectionStatus {
  switch (outcome) {
    case "reachable":
      return "已连接";
    case "rate-limited":
      return "限流中";
    case "timeout":
      return "不可达";
    case "auth-rejected":
      return "凭据失效";
  }
}

/** The only place `已隔离` is produced: a policy decision, with no probe involved. */
export function isolatedByPolicy(): ConnectionStatus {
  return "已隔离";
}

/**
 * A newly registered server when switch 1 (default isolation) is on: `待安全评审 ∧ 已隔离`
 * (I-18). Both fields are set explicitly -- neither is derived from the other, because they
 * are not derivable from each other in general (that is the whole of I-17); they merely
 * coincide at registration time.
 */
export function initialStatusOnRegister(defaultIsolationOn: boolean): {
  reviewStatus: ReviewStatus;
  connectionStatus: ConnectionStatus;
} {
  return {
    reviewStatus: "待安全评审",
    connectionStatus: defaultIsolationOn ? isolatedByPolicy() : "已连接",
  };
}

/**
 * Whether a server's tools may be called, and -- when they may not -- WHICH field is the
 * reason.
 *
 * ⚠ Returning the blocking field rather than a bare boolean is the operational payoff of
 * keeping the fields apart. "This tool is unavailable" is not an answer anybody can act on;
 * "unavailable because the endpoint is unreachable" and "unavailable because nobody has
 * reviewed it" send you to two different places.
 */
export type CallabilityBlock =
  | { callable: true }
  | { callable: false; blockedBy: "reviewStatus" | "connectionStatus"; detail: string };

export function callability(server: {
  reviewStatus: ReviewStatus;
  connectionStatus: ConnectionStatus;
}): CallabilityBlock {
  // Review first: an unreviewed server is not callable even if it is perfectly reachable.
  if (
    server.reviewStatus === "待安全评审" ||
    server.reviewStatus === "维持隔离" ||
    server.reviewStatus === "已到期待复核"
  ) {
    return { callable: false, blockedBy: "reviewStatus", detail: server.reviewStatus };
  }
  if (server.connectionStatus !== "已连接" && server.connectionStatus !== "限流中") {
    return { callable: false, blockedBy: "connectionStatus", detail: server.connectionStatus };
  }
  return { callable: true };
}

/**
 * I-25: `已放行` implies an auth scope has been set. There is no "connected but scope
 * undecided" row -- an undecided scope is not a stricter rule, it is an UNANSWERABLE one, and
 * downstream implementers read unanswerable as "allow".
 */
export function violatesScopeOnRelease(server: {
  reviewStatus: ReviewStatus;
  authScope: AuthScope | null;
}): boolean {
  return server.reviewStatus === "已放行" && server.authScope === null;
}
